//! SSH session management: interactive shell (PTY) streaming, SFTP, and port
//! forwarding. Built on `russh`.

use async_trait::async_trait;
use russh::client::{self, Handle, Handler};
use russh::{ChannelId, ChannelMsg, Disconnect, Pty};
use russh_keys::decode_secret_key;
use russh_keys::key::{KeyPair, PublicKey};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex};

use crate::vault::{ResolvedAuth, Vault};

/// Commands sent to a live shell session task.
pub enum SessionCmd {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

#[derive(Clone)]
pub struct SshManager {
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<SessionCmd>>>>,
    forwards: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    vault: Arc<Vault>,
}

impl SshManager {
    pub fn new(vault: Arc<Vault>) -> Self {
        SshManager {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            forwards: Arc::new(Mutex::new(HashMap::new())),
            vault,
        }
    }
}

// ---- russh client handler: verify server key against known-hosts (TOFU) ----

struct ClientHandler {
    /// Known fingerprint for this host, if any. None ⇒ trust-on-first-use.
    expected: Option<String>,
    /// What the server actually presented: (fingerprint, key_type).
    seen: Arc<std::sync::Mutex<Option<(String, String)>>>,
    /// For remote (reverse) forwarding: where to deliver inbound channels.
    forward: Option<(String, u16)>,
}

fn fingerprint_of(key: &PublicKey) -> String {
    format!("SHA256:{}", key.fingerprint())
}

#[async_trait]
impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fp = fingerprint_of(server_public_key);
        let key_type = server_public_key.name().to_string();
        *self.seen.lock().unwrap() = Some((fp.clone(), key_type));
        match &self.expected {
            Some(known) => Ok(known == &fp), // reject on mismatch (possible MITM)
            None => Ok(true),                // first use: accept, caller will remember
        }
    }

    /// A remote-forwarded connection arrived: pipe it to the local destination.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<russh::client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        if let Some((host, port)) = self.forward.clone() {
            tokio::spawn(async move {
                if let Ok(mut tcp) = tokio::net::TcpStream::connect((host.as_str(), port)).await {
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
                }
            });
        }
        Ok(())
    }
}

/// Connection parameters resolved from the vault.
pub struct ConnectParams {
    pub address: String,
    pub port: u16,
    pub username: String,
    pub auth: ResolvedAuth,
    pub cols: u16,
    pub rows: u16,
    /// Optional jump (bastion) host to tunnel the connection through.
    pub jump: Option<Box<ConnectParams>>,
}

/// Jump-host handles that must be kept alive for the duration of the session.
type Keepalive = Vec<Handle<ClientHandler>>;

impl SshManager {
    /// Connect + verify the host key + authenticate. Connects through a jump
    /// host first when one is configured. On a brand-new host the presented key
    /// is remembered (TOFU); on a mismatch the connection is refused.
    ///
    /// Returns the target handle plus any upstream jump handles that must stay
    /// alive (dropping them would tear down the tunnel).
    async fn connect(
        &self,
        p: &ConnectParams,
    ) -> anyhow::Result<(Handle<ClientHandler>, Keepalive)> {
        self.connect_with(p, None).await
    }

    async fn connect_with(
        &self,
        p: &ConnectParams,
        forward: Option<(String, u16)>,
    ) -> anyhow::Result<(Handle<ClientHandler>, Keepalive)> {
        let host_key = format!("{}:{}", p.address, p.port);
        let expected = self.vault.known_fingerprint(&host_key);
        let had_expected = expected.is_some();
        let seen = Arc::new(std::sync::Mutex::new(None));
        let handler = ClientHandler {
            expected,
            seen: seen.clone(),
            forward,
        };

        let config = Arc::new(client::Config::default());
        let mut keepalive: Keepalive = Vec::new();

        let connect_res = if let Some(jump) = &p.jump {
            // Establish the upstream hop, then open a direct-tcpip channel to the
            // target and run SSH over that stream.
            let (jump_handle, chain) = Box::pin(self.connect_with(jump, None)).await?;
            keepalive = chain;
            match jump_handle
                .channel_open_direct_tcpip(
                    p.address.clone(),
                    p.port as u32,
                    "127.0.0.1".to_string(),
                    0,
                )
                .await
            {
                Ok(channel) => {
                    let stream = channel.into_stream();
                    keepalive.push(jump_handle);
                    client::connect_stream(config, stream, handler).await
                }
                Err(e) => anyhow::bail!("failed to open channel on jump host: {e}"),
            }
        } else {
            client::connect(config, (p.address.as_str(), p.port), handler).await
        };

        // Distinguish a host-key mismatch from a generic connection failure.
        let presented = seen.lock().unwrap().clone();
        let mut handle = match connect_res {
            Ok(h) => h,
            Err(e) => {
                if had_expected {
                    if let Some((fp, _)) = presented {
                        anyhow::bail!(
                            "⚠ REMOTE HOST KEY HAS CHANGED for {host_key}!\n\
                             Presented key {fp} does not match the stored fingerprint.\n\
                             This could be a man-in-the-middle attack. \
                             If you trust this change, remove the host from Known Hosts and reconnect."
                        );
                    }
                }
                return Err(anyhow::anyhow!(
                    "could not connect to {host_key}: {e}"
                ));
            }
        };

        // Remember the key on first successful use.
        if !had_expected {
            if let Some((fp, key_type)) = presented {
                let _ = self.vault.remember_host(&host_key, &fp, &key_type);
            }
        }

        let ok = match &p.auth {
            ResolvedAuth::Password(pw) => handle.authenticate_password(&p.username, pw).await?,
            ResolvedAuth::Key {
                private_key,
                passphrase,
            } => {
                let key: KeyPair = decode_secret_key(private_key, passphrase.as_deref())?;
                handle
                    .authenticate_publickey(&p.username, Arc::new(key))
                    .await?
            }
            ResolvedAuth::Agent => {
                anyhow::bail!("SSH agent auth is not available on this build");
            }
        };

        if !ok {
            anyhow::bail!("authentication failed");
        }
        Ok((handle, keepalive))
    }

    /// Open an interactive shell and stream output to the frontend through
    /// Tauri events: `ssh://data/<id>`, `ssh://closed/<id>`, `ssh://error/<id>`.
    pub async fn open_shell(
        &self,
        app: AppHandle,
        id: String,
        params: ConnectParams,
    ) -> anyhow::Result<()> {
        let (handle, keepalive) = self.connect(&params).await?;
        let channel = handle.channel_open_session().await?;

        channel
            .request_pty(
                false,
                "xterm-256color",
                params.cols as u32,
                params.rows as u32,
                0,
                0,
                &[(Pty::ECHO, 1), (Pty::TTY_OP_ISPEED, 14400), (Pty::TTY_OP_OSPEED, 14400)],
            )
            .await?;
        channel.request_shell(true).await?;

        let (tx, mut rx) = mpsc::unbounded_channel::<SessionCmd>();
        self.sessions.lock().await.insert(id.clone(), tx);

        let sessions = self.sessions.clone();
        tokio::spawn(async move {
            let _keepalive = keepalive; // keep jump-host tunnels open for the session
            let mut channel = channel;
            loop {
                tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { ref data }) => {
                                let _ = app.emit(
                                    &format!("ssh://data/{id}"),
                                    String::from_utf8_lossy(data).to_string(),
                                );
                            }
                            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                let _ = app.emit(
                                    &format!("ssh://data/{id}"),
                                    String::from_utf8_lossy(data).to_string(),
                                );
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                                break;
                            }
                            _ => {}
                        }
                    }
                    cmd = rx.recv() => {
                        match cmd {
                            Some(SessionCmd::Data(bytes)) => {
                                let _ = channel.data(&bytes[..]).await;
                            }
                            Some(SessionCmd::Resize { cols, rows }) => {
                                let _ = channel
                                    .window_change(cols as u32, rows as u32, 0, 0)
                                    .await;
                            }
                            Some(SessionCmd::Close) | None => {
                                let _ = channel.eof().await;
                                break;
                            }
                        }
                    }
                }
            }
            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "en")
                .await;
            sessions.lock().await.remove(&id);
            let _ = app.emit(&format!("ssh://closed/{id}"), ());
        });

        Ok(())
    }

    pub async fn send_input(&self, id: &str, data: Vec<u8>) -> anyhow::Result<()> {
        if let Some(tx) = self.sessions.lock().await.get(id) {
            tx.send(SessionCmd::Data(data))
                .map_err(|_| anyhow::anyhow!("session closed"))?;
        }
        Ok(())
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        if let Some(tx) = self.sessions.lock().await.get(id) {
            let _ = tx.send(SessionCmd::Resize { cols, rows });
        }
        Ok(())
    }

    pub async fn close(&self, id: &str) -> anyhow::Result<()> {
        if let Some(tx) = self.sessions.lock().await.get(id) {
            let _ = tx.send(SessionCmd::Close);
        }
        Ok(())
    }

    // ---- SFTP ----

    pub async fn sftp_list(
        &self,
        params: ConnectParams,
        path: String,
    ) -> anyhow::Result<SftpListing> {
        let (handle, _keepalive) = self.connect(&params).await?;
        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream()).await?;
        let dir = if path.is_empty() {
            sftp.canonicalize(".").await.unwrap_or_else(|_| ".".into())
        } else {
            path
        };
        let mut out = Vec::new();
        let entries = sftp.read_dir(&dir).await?;
        for e in entries {
            let meta = e.metadata();
            out.push(SftpEntry {
                name: e.file_name(),
                is_dir: meta.is_dir(),
                size: meta.size.unwrap_or(0),
                modified: meta.mtime.unwrap_or(0) as i64,
            });
        }
        out.sort_by(|a, b| (b.is_dir, a.name.to_lowercase()).cmp(&(a.is_dir, b.name.to_lowercase())));
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(SftpListing { cwd: dir, entries: out })
    }

    pub async fn sftp_download(
        &self,
        params: ConnectParams,
        remote: String,
        local: String,
    ) -> anyhow::Result<u64> {
        let (handle, _keepalive) = self.connect(&params).await?;
        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream()).await?;
        let mut rf = sftp.open(&remote).await?;
        let mut buf = Vec::new();
        rf.read_to_end(&mut buf).await?;
        tokio::fs::write(&local, &buf).await?;
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(buf.len() as u64)
    }

    pub async fn sftp_upload(
        &self,
        params: ConnectParams,
        local: String,
        remote: String,
    ) -> anyhow::Result<u64> {
        let (handle, _keepalive) = self.connect(&params).await?;
        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream()).await?;
        let bytes = tokio::fs::read(&local).await?;
        let mut wf = sftp.create(&remote).await?;
        wf.write_all(&bytes).await?;
        wf.flush().await?;
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(bytes.len() as u64)
    }

    /// Read a remote file fully into memory (used for host-to-host transfers).
    pub async fn sftp_read(&self, params: ConnectParams, remote: String) -> anyhow::Result<Vec<u8>> {
        let (handle, _keepalive) = self.connect(&params).await?;
        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream()).await?;
        let mut rf = sftp.open(&remote).await?;
        let mut buf = Vec::new();
        rf.read_to_end(&mut buf).await?;
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(buf)
    }

    /// Write bytes to a remote file (used for host-to-host transfers).
    pub async fn sftp_write(
        &self,
        params: ConnectParams,
        remote: String,
        bytes: Vec<u8>,
    ) -> anyhow::Result<u64> {
        let (handle, _keepalive) = self.connect(&params).await?;
        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream()).await?;
        let mut wf = sftp.create(&remote).await?;
        wf.write_all(&bytes).await?;
        wf.flush().await?;
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(bytes.len() as u64)
    }

    async fn open_sftp(
        &self,
        params: &ConnectParams,
    ) -> anyhow::Result<(Handle<ClientHandler>, Keepalive, russh_sftp::client::SftpSession)> {
        let (handle, keepalive) = self.connect(params).await?;
        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream()).await?;
        Ok((handle, keepalive, sftp))
    }

    pub async fn sftp_rename(
        &self,
        params: ConnectParams,
        from: String,
        to: String,
    ) -> anyhow::Result<()> {
        let (handle, _k, sftp) = self.open_sftp(&params).await?;
        sftp.rename(from, to).await?;
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(())
    }

    pub async fn sftp_mkdir(&self, params: ConnectParams, path: String) -> anyhow::Result<()> {
        let (handle, _k, sftp) = self.open_sftp(&params).await?;
        sftp.create_dir(path).await?;
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(())
    }

    pub async fn sftp_delete(
        &self,
        params: ConnectParams,
        path: String,
        is_dir: bool,
    ) -> anyhow::Result<()> {
        let (handle, _k, sftp) = self.open_sftp(&params).await?;
        if is_dir {
            remove_dir_recursive(&sftp, &path).await?;
        } else {
            sftp.remove_file(path).await?;
        }
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(())
    }

    // ---- local port forwarding ----

    pub async fn start_local_forward(
        &self,
        id: String,
        params: ConnectParams,
        bind_address: String,
        bind_port: u16,
        dest_host: String,
        dest_port: u16,
    ) -> anyhow::Result<()> {
        let (handle, keepalive) = self.connect(&params).await?;
        let listener =
            tokio::net::TcpListener::bind((bind_address.as_str(), bind_port)).await?;
        let handle = Arc::new(handle);
        let task = tokio::spawn(async move {
            let _keepalive = keepalive; // keep jump-host tunnels open while forwarding
            loop {
                let (mut socket, _) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let handle = handle.clone();
                let dest_host = dest_host.clone();
                let originator = "127.0.0.1".to_string();
                tokio::spawn(async move {
                    let channel = match handle
                        .channel_open_direct_tcpip(
                            dest_host,
                            dest_port as u32,
                            originator,
                            0,
                        )
                        .await
                    {
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                });
            }
        });
        self.forwards.lock().await.insert(id, task);
        Ok(())
    }

    /// Remote (reverse) forward: ask the server to listen on `bind` and pipe
    /// every inbound connection back to `dest` on this machine.
    pub async fn start_remote_forward(
        &self,
        id: String,
        params: ConnectParams,
        bind_address: String,
        bind_port: u16,
        dest_host: String,
        dest_port: u16,
    ) -> anyhow::Result<()> {
        let (mut handle, keepalive) = self
            .connect_with(&params, Some((dest_host, dest_port)))
            .await?;
        handle
            .tcpip_forward(&bind_address, bind_port as u32)
            .await?;
        // Keep the session (and any jump tunnels) alive until the rule is stopped.
        let task = tokio::spawn(async move {
            let _keepalive = keepalive;
            let _handle = handle;
            futures::future::pending::<()>().await;
        });
        self.forwards.lock().await.insert(id, task);
        Ok(())
    }

    /// Dynamic forward: run a minimal SOCKS5 proxy on `bind` and open a
    /// direct-tcpip channel per request through the SSH connection.
    pub async fn start_dynamic_forward(
        &self,
        id: String,
        params: ConnectParams,
        bind_address: String,
        bind_port: u16,
    ) -> anyhow::Result<()> {
        let (handle, keepalive) = self.connect(&params).await?;
        let listener =
            tokio::net::TcpListener::bind((bind_address.as_str(), bind_port)).await?;
        let handle = Arc::new(handle);
        let task = tokio::spawn(async move {
            let _keepalive = keepalive;
            loop {
                let (socket, _) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let handle = handle.clone();
                tokio::spawn(async move {
                    let _ = handle_socks(handle, socket).await;
                });
            }
        });
        self.forwards.lock().await.insert(id, task);
        Ok(())
    }

    pub async fn stop_forward(&self, id: &str) -> anyhow::Result<()> {
        if let Some(task) = self.forwards.lock().await.remove(id) {
            task.abort();
        }
        Ok(())
    }
}

/// Minimal SOCKS5 (no auth, CONNECT only) bridged over an SSH direct-tcpip channel.
async fn handle_socks(
    handle: Arc<Handle<ClientHandler>>,
    mut socket: tokio::net::TcpStream,
) -> anyhow::Result<()> {
    // greeting
    let mut head = [0u8; 2];
    socket.read_exact(&mut head).await?;
    if head[0] != 0x05 {
        anyhow::bail!("not socks5");
    }
    let mut methods = vec![0u8; head[1] as usize];
    socket.read_exact(&mut methods).await?;
    socket.write_all(&[0x05, 0x00]).await?; // no auth

    // request: VER CMD RSV ATYP
    let mut req = [0u8; 4];
    socket.read_exact(&mut req).await?;
    if req[1] != 0x01 {
        // only CONNECT
        socket
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        anyhow::bail!("unsupported socks command");
    }
    let dest_host = match req[3] {
        0x01 => {
            let mut a = [0u8; 4];
            socket.read_exact(&mut a).await?;
            format!("{}.{}.{}.{}", a[0], a[1], a[2], a[3])
        }
        0x03 => {
            let mut l = [0u8; 1];
            socket.read_exact(&mut l).await?;
            let mut d = vec![0u8; l[0] as usize];
            socket.read_exact(&mut d).await?;
            String::from_utf8_lossy(&d).to_string()
        }
        0x04 => {
            let mut a = [0u8; 16];
            socket.read_exact(&mut a).await?;
            std::net::Ipv6Addr::from(a).to_string()
        }
        _ => anyhow::bail!("bad socks address type"),
    };
    let mut portb = [0u8; 2];
    socket.read_exact(&mut portb).await?;
    let dest_port = u16::from_be_bytes(portb);

    match handle
        .channel_open_direct_tcpip(dest_host, dest_port as u32, "127.0.0.1".to_string(), 0)
        .await
    {
        Ok(channel) => {
            socket
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
        }
        Err(_) => {
            socket
                .write_all(&[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
        }
    }
    Ok(())
}

async fn remove_dir_recursive(
    sftp: &russh_sftp::client::SftpSession,
    path: &str,
) -> anyhow::Result<()> {
    let base = path.trim_end_matches('/');
    for entry in sftp.read_dir(path).await? {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = format!("{base}/{name}");
        if entry.metadata().is_dir() {
            Box::pin(remove_dir_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(child).await?;
        }
    }
    sftp.remove_dir(base.to_string()).await?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListing {
    pub cwd: String,
    pub entries: Vec<SftpEntry>,
}

// keep ChannelId import used (some russh versions need it in scope)
#[allow(dead_code)]
fn _channel_id_marker(_: ChannelId) {}
