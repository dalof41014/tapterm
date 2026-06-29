//! Encrypted local vault — stores hosts, SSH keys, snippets, groups and
//! port-forward rules. The on-disk file is encrypted with AES-256-GCM using a
//! key derived from the user's master password via Argon2id.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

// ---------- data model ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value")]
pub enum AuthMethod {
    Password(String),
    Key(String), // SshKey id
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub label: String,
    pub address: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Optional jump (bastion) host id to tunnel this connection through.
    #[serde(default)]
    pub jump_host_id: Option<String>,
    /// Optional terminal font id override for this host.
    #[serde(default)]
    pub font: Option<String>,
    /// Connection protocol: "ssh" (default) or "telnet".
    #[serde(default)]
    pub protocol: Option<String>,
    /// Wrap the SSH shell in tmux so the session survives drops (persistent).
    #[serde(default)]
    pub persistent: bool,
    /// tmux session name to attach/create when `persistent` (default "tapterm").
    #[serde(default)]
    pub persist_session: Option<String>,
}

fn default_port() -> u16 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub id: String,
    pub label: String,
    pub private_key: String,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub public_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub label: String,
    pub command: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ForwardKind {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForward {
    pub id: String,
    pub label: String,
    pub host_id: String,
    pub kind: ForwardKind,
    pub bind_address: String,
    pub bind_port: u16,
    #[serde(default)]
    pub dest_host: Option<String>,
    #[serde(default)]
    pub dest_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,        // "address:port"
    pub fingerprint: String, // "SHA256:..."
    #[serde(default)]
    pub key_type: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultData {
    #[serde(default)]
    pub groups: Vec<Group>,
    #[serde(default)]
    pub hosts: Vec<Host>,
    #[serde(default)]
    pub keys: Vec<SshKey>,
    #[serde(default)]
    pub snippets: Vec<Snippet>,
    #[serde(default)]
    pub port_forwards: Vec<PortForward>,
    #[serde(default)]
    pub known_hosts: Vec<KnownHost>,
}

// ---------- on-disk envelope ----------

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u8,
    salt: String,  // base64
    nonce: String, // base64
    ct: String,    // base64 ciphertext
    /// True when encrypted with the built-in key (no user password). Stored in
    /// plaintext so any device reading a synced vault can auto-unlock it.
    #[serde(default)]
    no_password: bool,
}

// ---------- vault state ----------

pub struct Vault {
    inner: Mutex<VaultInner>,
}

struct VaultInner {
    path: PathBuf,
    key: Option<[u8; 32]>, // derived master key, present when unlocked
    salt: [u8; 16],
    data: VaultData,
    unlocked: bool,
    no_password: bool,
}

impl Vault {
    pub fn new() -> Self {
        let path = vault_path();
        Vault {
            inner: Mutex::new(VaultInner {
                path,
                key: None,
                salt: [0u8; 16],
                data: VaultData::default(),
                unlocked: false,
                no_password: false,
            }),
        }
    }

    /// Whether the on-disk vault file is a no-password (built-in key) vault.
    pub fn file_no_password(&self) -> bool {
        let g = self.inner.lock().unwrap();
        std::fs::read(&g.path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Envelope>(&b).ok())
            .map(|e| e.no_password)
            .unwrap_or(false)
    }

    /// Mark the current (unlocked) vault as no-password and persist, so the
    /// marker lands in the file (used to upgrade older no-password vaults).
    pub fn upgrade_no_password(&self) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        if g.unlocked && !g.no_password {
            g.no_password = true;
            persist(&g)?;
        }
        Ok(())
    }

    pub fn exists(&self) -> bool {
        self.inner.lock().unwrap().path.exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.inner.lock().unwrap().unlocked
    }

    /// Create a brand new vault protected by `password`.
    pub fn init(&self, password: &str, no_password: bool) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let key = derive_key(password, &salt)?;
        g.salt = salt;
        g.key = Some(key);
        g.data = VaultData::default();
        g.unlocked = true;
        g.no_password = no_password;
        persist(&g)
    }

    /// Unlock an existing vault.
    pub fn unlock(&self, password: &str) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        let raw = std::fs::read(&g.path)?;
        let env: Envelope = serde_json::from_slice(&raw)?;
        let salt_v = B64.decode(env.salt.as_bytes())?;
        let nonce_v = B64.decode(env.nonce.as_bytes())?;
        let ct = B64.decode(env.ct.as_bytes())?;
        let mut salt = [0u8; 16];
        salt.copy_from_slice(&salt_v[..16]);
        let key = derive_key(password, &salt)?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| anyhow::anyhow!("{e}"))?;
        let pt = cipher
            .decrypt(Nonce::from_slice(&nonce_v), ct.as_ref())
            .map_err(|_| anyhow::anyhow!("invalid master password"))?;
        let data: VaultData = serde_json::from_slice(&pt)?;
        g.salt = salt;
        g.key = Some(key);
        g.data = data;
        g.unlocked = true;
        g.no_password = env.no_password;
        Ok(())
    }

    pub fn lock(&self) {
        let mut g = self.inner.lock().unwrap();
        g.key = None;
        g.data = VaultData::default();
        g.unlocked = false;
    }

    /// Re-encrypt the current (unlocked) data under a new password, keeping all
    /// data. Used to set, change, or remove the master password.
    pub fn rekey(&self, password: &str, no_password: bool) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        ensure_unlocked(&g)?;
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let key = derive_key(password, &salt)?;
        g.salt = salt;
        g.key = Some(key);
        g.no_password = no_password;
        persist(&g)
    }

    // ---- sync helpers (operate on the ciphertext file) ----

    pub fn path_string(&self) -> String {
        self.inner.lock().unwrap().path.to_string_lossy().to_string()
    }

    pub fn file_mtime(&self) -> Option<i64> {
        let g = self.inner.lock().unwrap();
        std::fs::metadata(&g.path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
    }

    pub fn file_bytes(&self) -> Option<Vec<u8>> {
        let g = self.inner.lock().unwrap();
        std::fs::read(&g.path).ok()
    }

    /// Overwrite the local ciphertext file (used when pulling from the cloud)
    /// and drop unlocked state so the user re-unlocks against the new contents.
    pub fn write_file_bytes(&self, bytes: &[u8]) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        write_atomic_retry(&g.path, bytes)?;
        g.key = None;
        g.data = VaultData::default();
        g.unlocked = false;
        Ok(())
    }

    /// Move the vault to `new_path`, or adopt a file already present there.
    pub fn relocate(&self, new_path: PathBuf, adopt_existing: bool) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        if let Some(parent) = new_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let cur = g.path.clone();
        if new_path.exists() && adopt_existing {
            // use the file already at the destination as-is
        } else if cur.exists() && cur != new_path {
            // copy our data to the new location; leave the source in place so we
            // never delete a file another device may still be syncing.
            std::fs::copy(&cur, &new_path)?;
        }
        g.path = new_path;
        g.key = None;
        g.data = VaultData::default();
        g.unlocked = false;
        Ok(())
    }

    pub fn snapshot(&self) -> anyhow::Result<VaultData> {
        let g = self.inner.lock().unwrap();
        ensure_unlocked(&g)?;
        Ok(g.data.clone())
    }

    /// Replace the whole dataset and persist. The `known_hosts` list is
    /// backend-owned, so an incoming save never clobbers it.
    pub fn replace(&self, mut data: VaultData) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        ensure_unlocked(&g)?;
        data.known_hosts = std::mem::take(&mut g.data.known_hosts);
        g.data = data;
        persist(&g)
    }

    // ---- known-hosts ----

    pub fn known_fingerprint(&self, host: &str) -> Option<String> {
        let g = self.inner.lock().unwrap();
        g.data
            .known_hosts
            .iter()
            .find(|k| k.host == host)
            .map(|k| k.fingerprint.clone())
    }

    pub fn remember_host(&self, host: &str, fingerprint: &str, key_type: &str) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        if !g.unlocked {
            return Ok(()); // best-effort; nothing to persist into
        }
        if let Some(k) = g.data.known_hosts.iter_mut().find(|k| k.host == host) {
            k.fingerprint = fingerprint.to_string();
            k.key_type = key_type.to_string();
        } else {
            g.data.known_hosts.push(KnownHost {
                host: host.to_string(),
                fingerprint: fingerprint.to_string(),
                key_type: key_type.to_string(),
            });
        }
        persist(&g)
    }

    pub fn forget_host(&self, host: &str) -> anyhow::Result<()> {
        let mut g = self.inner.lock().unwrap();
        ensure_unlocked(&g)?;
        g.data.known_hosts.retain(|k| k.host != host);
        persist(&g)
    }

    pub fn list_known(&self) -> Vec<KnownHost> {
        self.inner.lock().unwrap().data.known_hosts.clone()
    }

    /// Look up a host together with its resolved auth secret.
    pub fn resolve_host(&self, host_id: &str) -> anyhow::Result<(Host, ResolvedAuth)> {
        let g = self.inner.lock().unwrap();
        ensure_unlocked(&g)?;
        let host = g
            .data
            .hosts
            .iter()
            .find(|h| h.id == host_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("host not found"))?;
        let auth = match &host.auth {
            AuthMethod::Password(p) => ResolvedAuth::Password(p.clone()),
            AuthMethod::Agent => ResolvedAuth::Agent,
            AuthMethod::Key(key_id) => {
                let k = g
                    .data
                    .keys
                    .iter()
                    .find(|k| &k.id == key_id)
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("ssh key not found"))?;
                ResolvedAuth::Key {
                    private_key: k.private_key,
                    passphrase: k.passphrase,
                }
            }
        };
        Ok((host, auth))
    }
}

pub enum ResolvedAuth {
    Password(String),
    Key {
        private_key: String,
        passphrase: Option<String>,
    },
    Agent,
}

fn ensure_unlocked(g: &VaultInner) -> anyhow::Result<()> {
    if !g.unlocked {
        anyhow::bail!("vault is locked");
    }
    Ok(())
}

/// Persist the current in-memory data using the unlocked key/salt.
fn persist(g: &VaultInner) -> anyhow::Result<()> {
    let key = g.key.ok_or_else(|| anyhow::anyhow!("vault is locked"))?;
    write_vault(&g.path, &key, &g.salt, &g.data, g.no_password)
}

fn derive_key(password: &str, salt: &[u8; 16]) -> anyhow::Result<[u8; 32]> {
    let argon = Argon2::default();
    let mut out = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| anyhow::anyhow!("kdf failed: {e}"))?;
    Ok(out)
}

fn write_vault(
    path: &PathBuf,
    key: &[u8; 32],
    salt: &[u8; 16],
    data: &VaultData,
    no_password: bool,
) -> anyhow::Result<()> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| anyhow::anyhow!("{e}"))?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let pt = serde_json::to_vec(data)?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), pt.as_ref())
        .map_err(|e| anyhow::anyhow!("encrypt failed: {e}"))?;
    let env = Envelope {
        version: 1,
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        ct: B64.encode(ct),
        no_password,
    };
    write_atomic_retry(path, &serde_json::to_vec_pretty(&env)?)?;
    Ok(())
}

/// Write `bytes` to `path` resiliently. Cloud-sync folders (Google Drive for
/// Desktop, Dropbox, OneDrive) intermittently lock or briefly hide the target
/// file while they sync it — surfacing as os error 3 (path not found), 5
/// (access denied) or 32 (sharing violation). We write atomically (temp file +
/// rename) and retry a few times with backoff before giving up, with a plain
/// in-place write as a last-ditch fallback each round.
fn write_atomic_retry(path: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_file_name(format!(
        "{}.tmp",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("vault.json")
    ));

    let mut last: Option<std::io::Error> = None;
    for attempt in 0..6u64 {
        match std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, path)) {
            Ok(()) => return Ok(()),
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                // last-ditch in-place write in case rename is what's blocked
                if std::fs::write(path, bytes).is_ok() {
                    return Ok(());
                }
                last = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(150 * (attempt + 1)));
            }
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "write failed")))
}

fn vault_path() -> PathBuf {
    crate::sync::resolve_vault_path(&crate::sync::load())
}
