mod gdrive;
mod ssh;
mod sync;
mod vault;

use sync::GDriveConfig;

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ssh::{ConnectParams, SftpEntry, SftpListing, SshManager};
use tauri::{AppHandle, State};
use vault::{KnownHost, Vault, VaultData};

struct AppState {
    vault: Arc<Vault>,
    ssh: SshManager,
}

fn map_err<T>(r: anyhow::Result<T>) -> Result<T, String> {
    r.map_err(|e| e.to_string())
}

// ---------- vault commands ----------

#[derive(serde::Serialize)]
struct VaultStatus {
    exists: bool,
    unlocked: bool,
}

#[tauri::command]
fn vault_status(state: State<AppState>) -> VaultStatus {
    VaultStatus {
        exists: state.vault.exists(),
        unlocked: state.vault.is_unlocked(),
    }
}

/// Built-in passphrase used when the user opts out of a master password. The
/// vault is still encrypted at rest, but unlocks automatically on launch.
const NO_PASSWORD_KEY: &str = "terminal::no-password::v1";

#[tauri::command]
fn vault_init(state: State<AppState>, password: String) -> Result<(), String> {
    let _ = sync::set_no_password(false);
    map_err(state.vault.init(&password))
}

#[tauri::command]
fn vault_init_nopass(state: State<AppState>) -> Result<(), String> {
    map_err(state.vault.init(NO_PASSWORD_KEY))?;
    map_err(sync::set_no_password(true))
}

/// If the vault was created without a password, unlock it silently. Returns
/// whether the vault ended up unlocked.
#[tauri::command]
fn vault_autounlock(state: State<AppState>) -> bool {
    if state.vault.is_unlocked() {
        return true;
    }
    if sync::load().no_password && state.vault.exists() {
        let _ = state.vault.unlock(NO_PASSWORD_KEY);
    }
    state.vault.is_unlocked()
}

/// Set or change the master password (vault must be unlocked). Disables
/// auto-unlock so the password is required on next launch.
#[tauri::command]
fn vault_set_password(state: State<AppState>, password: String) -> Result<(), String> {
    map_err(state.vault.rekey(&password))?;
    map_err(sync::set_no_password(false))
}

/// Remove the master password: re-encrypt under a built-in key and auto-unlock
/// on future launches.
#[tauri::command]
fn vault_remove_password(state: State<AppState>) -> Result<(), String> {
    map_err(state.vault.rekey(NO_PASSWORD_KEY))?;
    map_err(sync::set_no_password(true))
}

#[tauri::command]
fn vault_unlock(state: State<AppState>, password: String) -> Result<(), String> {
    map_err(state.vault.unlock(&password))
}

#[tauri::command]
fn vault_lock(state: State<AppState>) {
    state.vault.lock();
}

#[tauri::command]
fn vault_get(state: State<AppState>) -> Result<VaultData, String> {
    map_err(state.vault.snapshot())
}

#[tauri::command]
fn vault_save(state: State<AppState>, data: VaultData) -> Result<(), String> {
    map_err(state.vault.replace(data))
}

// ---------- known-hosts commands ----------

#[tauri::command]
fn kh_list(state: State<AppState>) -> Vec<KnownHost> {
    state.vault.list_known()
}

#[tauri::command]
fn kh_forget(state: State<AppState>, host: String) -> Result<(), String> {
    map_err(state.vault.forget_host(&host))
}

// ---------- sync (folder mode) commands ----------

#[tauri::command]
fn sync_status() -> sync::SyncStatus {
    sync::status(&sync::load())
}

#[tauri::command]
fn sync_set_folder(state: State<AppState>, folder: String) -> Result<sync::SyncStatus, String> {
    let mut file = std::path::PathBuf::from(&folder);
    file.push("vault.json");
    let adopt = file.exists();
    map_err(state.vault.relocate(file.clone(), adopt))?;
    let mut cfg = sync::load();
    cfg.mode = "folder".to_string();
    cfg.folder_path = Some(file.to_string_lossy().to_string());
    map_err(sync::save(&cfg))?;
    Ok(sync::status(&cfg))
}

#[tauri::command]
fn sync_set_local(state: State<AppState>) -> Result<sync::SyncStatus, String> {
    let target = sync::default_vault_path();
    map_err(state.vault.relocate(target, false))?;
    let mut cfg = sync::load();
    cfg.mode = "local".to_string();
    cfg.folder_path = None;
    map_err(sync::save(&cfg))?;
    Ok(sync::status(&cfg))
}

// ---------- Google Drive sync commands ----------

#[tauri::command]
fn gdrive_set_credentials(
    client_id: String,
    client_secret: String,
) -> Result<sync::SyncStatus, String> {
    let mut cfg = sync::load();
    let mut g = cfg.gdrive.clone().unwrap_or(GDriveConfig {
        client_id: String::new(),
        client_secret: String::new(),
        refresh_token: None,
        file_id: None,
        email: None,
        connected: false,
    });
    g.client_id = client_id;
    g.client_secret = client_secret;
    cfg.gdrive = Some(g);
    map_err(sync::save(&cfg))?;
    Ok(sync::status(&cfg))
}

#[tauri::command]
async fn gdrive_connect(state: State<'_, AppState>) -> Result<sync::SyncStatus, String> {
    let mut cfg = sync::load();
    let mut g = cfg
        .gdrive
        .clone()
        .filter(|g| !g.client_id.is_empty())
        .ok_or_else(|| "Set your Google OAuth credentials first".to_string())?;

    let (refresh, email) = map_err(gdrive::run_oauth(&g.client_id, &g.client_secret).await)?;
    g.refresh_token = Some(refresh.clone());
    g.email = email;
    g.connected = true;
    cfg.gdrive = Some(g.clone());
    cfg.mode = "gdrive".to_string();
    map_err(sync::save(&cfg))?;

    // Initial reconcile: adopt the cloud copy if present, otherwise seed it.
    let token = map_err(gdrive::access_token(&g.client_id, &g.client_secret, &refresh).await)?;
    if let Some(remote) = map_err(gdrive::find_vault_file(&token).await)? {
        let bytes = map_err(gdrive::download(&token, &remote.id).await)?;
        map_err(state.vault.write_file_bytes(&bytes))?;
        cfg.gdrive.as_mut().unwrap().file_id = Some(remote.id);
        map_err(sync::save(&cfg))?;
    } else if let Some(bytes) = state.vault.file_bytes() {
        let id = map_err(gdrive::upload_create(&token, &bytes).await)?;
        cfg.gdrive.as_mut().unwrap().file_id = Some(id);
        map_err(sync::save(&cfg))?;
    }
    Ok(sync::status(&cfg))
}

#[tauri::command]
fn gdrive_disconnect() -> Result<sync::SyncStatus, String> {
    let mut cfg = sync::load();
    if let Some(g) = cfg.gdrive.as_mut() {
        g.connected = false;
        g.refresh_token = None;
        g.file_id = None;
    }
    cfg.mode = "local".to_string();
    map_err(sync::save(&cfg))?;
    Ok(sync::status(&cfg))
}

#[tauri::command]
async fn gdrive_push(state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = sync::load();
    let g = cfg
        .gdrive
        .clone()
        .filter(|g| g.connected)
        .ok_or_else(|| "Google Drive is not connected".to_string())?;
    let refresh = g
        .refresh_token
        .clone()
        .ok_or_else(|| "Google Drive is not connected".to_string())?;
    let bytes = state
        .vault
        .file_bytes()
        .ok_or_else(|| "No vault to upload yet".to_string())?;
    let token = map_err(gdrive::access_token(&g.client_id, &g.client_secret, &refresh).await)?;
    match g.file_id.clone() {
        Some(id) => map_err(gdrive::upload_update(&token, &id, &bytes).await)?,
        None => {
            let id = map_err(gdrive::upload_create(&token, &bytes).await)?;
            cfg.gdrive.as_mut().unwrap().file_id = Some(id);
            map_err(sync::save(&cfg))?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn gdrive_pull(state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = sync::load();
    let g = cfg
        .gdrive
        .clone()
        .filter(|g| g.connected)
        .ok_or_else(|| "Google Drive is not connected".to_string())?;
    let refresh = g
        .refresh_token
        .clone()
        .ok_or_else(|| "Google Drive is not connected".to_string())?;
    let token = map_err(gdrive::access_token(&g.client_id, &g.client_secret, &refresh).await)?;
    let remote = map_err(gdrive::find_vault_file(&token).await)?
        .ok_or_else(|| "No vault found in Google Drive yet".to_string())?;
    let bytes = map_err(gdrive::download(&token, &remote.id).await)?;
    map_err(state.vault.write_file_bytes(&bytes))?;
    cfg.gdrive.as_mut().unwrap().file_id = Some(remote.id);
    map_err(sync::save(&cfg))?;
    Ok(())
}

// ---------- helper: build connection params from a host id ----------

fn params_for(state: &AppState, host_id: &str, cols: u16, rows: u16) -> Result<ConnectParams, String> {
    params_for_chain(state, host_id, cols, rows, &mut Vec::new())
}

fn params_for_chain(
    state: &AppState,
    host_id: &str,
    cols: u16,
    rows: u16,
    seen: &mut Vec<String>,
) -> Result<ConnectParams, String> {
    if seen.iter().any(|h| h == host_id) {
        return Err("jump host configuration has a cycle".to_string());
    }
    seen.push(host_id.to_string());
    let (host, auth) = map_err(state.vault.resolve_host(host_id))?;
    let jump = match &host.jump_host_id {
        Some(jid) if !jid.is_empty() => {
            Some(Box::new(params_for_chain(state, jid, cols, rows, seen)?))
        }
        _ => None,
    };
    Ok(ConnectParams {
        address: host.address,
        port: host.port,
        username: host.username,
        auth,
        cols,
        rows,
        jump,
    })
}

// ---------- ssh shell commands ----------

#[tauri::command]
async fn ssh_open_shell(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    host_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let params = params_for(&state, &host_id, cols, rows)?;
    map_err(state.ssh.open_shell(app, id, params).await)
}

#[tauri::command]
async fn ssh_send(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    map_err(state.ssh.send_input(&id, data.into_bytes()).await)
}

#[tauri::command]
async fn ssh_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    map_err(state.ssh.resize(&id, cols, rows).await)
}

#[tauri::command]
async fn ssh_close(state: State<'_, AppState>, id: String) -> Result<(), String> {
    map_err(state.ssh.close(&id).await)
}

// ---------- sftp commands ----------

#[tauri::command]
async fn sftp_list(
    state: State<'_, AppState>,
    host_id: String,
    path: String,
) -> Result<SftpListing, String> {
    let params = params_for(&state, &host_id, 80, 24)?;
    map_err(state.ssh.sftp_list(params, path).await)
}

#[tauri::command]
async fn sftp_download(
    state: State<'_, AppState>,
    host_id: String,
    remote: String,
    local: String,
) -> Result<u64, String> {
    let params = params_for(&state, &host_id, 80, 24)?;
    map_err(state.ssh.sftp_download(params, remote, local).await)
}

#[tauri::command]
async fn sftp_upload(
    state: State<'_, AppState>,
    host_id: String,
    local: String,
    remote: String,
) -> Result<u64, String> {
    let params = params_for(&state, &host_id, 80, 24)?;
    map_err(state.ssh.sftp_upload(params, local, remote).await)
}

// ---------- local filesystem + cross-host transfer ----------

#[tauri::command]
fn local_home() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn local_list(path: String) -> Result<SftpListing, String> {
    use std::path::PathBuf;
    let dir = if path.is_empty() {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
    } else {
        PathBuf::from(&path)
    };
    let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for e in rd.flatten() {
        let meta = e.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        entries.push(SftpEntry {
            name: e.file_name().to_string_lossy().to_string(),
            is_dir,
            size,
            modified,
        });
    }
    entries.sort_by(|a, b| {
        (b.is_dir, a.name.to_lowercase()).cmp(&(a.is_dir, b.name.to_lowercase()))
    });
    Ok(SftpListing {
        cwd: dir.to_string_lossy().to_string(),
        entries,
    })
}

/// Transfer a file between any two endpoints (local or a host). `None` host id
/// means the local machine; host→host relays through this client.
#[tauri::command]
async fn sftp_transfer(
    state: State<'_, AppState>,
    src_host_id: Option<String>,
    src_path: String,
    dst_host_id: Option<String>,
    dst_path: String,
) -> Result<u64, String> {
    let bytes = match &src_host_id {
        Some(h) => {
            let p = params_for(&state, h, 80, 24)?;
            map_err(state.ssh.sftp_read(p, src_path).await)?
        }
        None => tokio::fs::read(&src_path).await.map_err(|e| e.to_string())?,
    };
    let len = bytes.len() as u64;
    match &dst_host_id {
        Some(h) => {
            let p = params_for(&state, h, 80, 24)?;
            map_err(state.ssh.sftp_write(p, dst_path, bytes).await)?;
        }
        None => tokio::fs::write(&dst_path, &bytes)
            .await
            .map_err(|e| e.to_string())?,
    }
    Ok(len)
}

/// Recursive file/dir transfer with progress events (`transfer://progress/<id>`).
#[tauri::command]
async fn transfer_start(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    src_host_id: Option<String>,
    src_path: String,
    dst_host_id: Option<String>,
    dst_path: String,
    is_dir: bool,
) -> Result<(), String> {
    let src = match &src_host_id {
        Some(h) => Some(params_for(&state, h, 80, 24)?),
        None => None,
    };
    let dst = match &dst_host_id {
        Some(h) => Some(params_for(&state, h, 80, 24)?),
        None => None,
    };
    map_err(
        state
            .ssh
            .transfer_tree(app, id, src, src_path, dst, dst_path, is_dir)
            .await,
    )
}

/// Read a file (local or remote) and return its bytes as base64 — used for
/// image previews. Capped to keep previews snappy.
#[tauri::command]
async fn file_read_b64(
    state: State<'_, AppState>,
    host_id: Option<String>,
    path: String,
) -> Result<String, String> {
    const MAX: usize = 16 * 1024 * 1024;
    let bytes = match &host_id {
        Some(h) => {
            let p = params_for(&state, h, 80, 24)?;
            map_err(state.ssh.sftp_read(p, path).await)?
        }
        None => tokio::fs::read(&path).await.map_err(|e| e.to_string())?,
    };
    if bytes.len() > MAX {
        return Err("file is too large to preview".to_string());
    }
    Ok(B64.encode(&bytes))
}

#[tauri::command]
async fn file_rename(
    state: State<'_, AppState>,
    host_id: Option<String>,
    from: String,
    to: String,
) -> Result<(), String> {
    match &host_id {
        Some(h) => {
            let p = params_for(&state, h, 80, 24)?;
            map_err(state.ssh.sftp_rename(p, from, to).await)
        }
        None => tokio::fs::rename(&from, &to).await.map_err(|e| e.to_string()),
    }
}

#[tauri::command]
async fn file_mkdir(
    state: State<'_, AppState>,
    host_id: Option<String>,
    path: String,
) -> Result<(), String> {
    match &host_id {
        Some(h) => {
            let p = params_for(&state, h, 80, 24)?;
            map_err(state.ssh.sftp_mkdir(p, path).await)
        }
        None => tokio::fs::create_dir(&path).await.map_err(|e| e.to_string()),
    }
}

#[tauri::command]
async fn file_delete(
    state: State<'_, AppState>,
    host_id: Option<String>,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    match &host_id {
        Some(h) => {
            let p = params_for(&state, h, 80, 24)?;
            map_err(state.ssh.sftp_delete(p, path, is_dir).await)
        }
        None => {
            let r = if is_dir {
                tokio::fs::remove_dir_all(&path).await
            } else {
                tokio::fs::remove_file(&path).await
            };
            r.map_err(|e| e.to_string())
        }
    }
}

// ---------- port forwarding ----------

#[tauri::command]
async fn forward_start(
    state: State<'_, AppState>,
    id: String,
    host_id: String,
    kind: String,
    bind_address: String,
    bind_port: u16,
    dest_host: String,
    dest_port: u16,
) -> Result<(), String> {
    let params = params_for(&state, &host_id, 80, 24)?;
    let r = match kind.as_str() {
        "Remote" => {
            state
                .ssh
                .start_remote_forward(id, params, bind_address, bind_port, dest_host, dest_port)
                .await
        }
        "Dynamic" => {
            state
                .ssh
                .start_dynamic_forward(id, params, bind_address, bind_port)
                .await
        }
        _ => {
            state
                .ssh
                .start_local_forward(id, params, bind_address, bind_port, dest_host, dest_port)
                .await
        }
    };
    map_err(r)
}

#[tauri::command]
async fn forward_stop(state: State<'_, AppState>, id: String) -> Result<(), String> {
    map_err(state.ssh.stop_forward(&id).await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Preserve data from the previous "Terminal" name.
    sync::migrate_storage();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage({
            let vault = Arc::new(Vault::new());
            AppState {
                vault: vault.clone(),
                ssh: SshManager::new(vault),
            }
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_init,
            vault_init_nopass,
            vault_autounlock,
            vault_set_password,
            vault_remove_password,
            vault_unlock,
            vault_lock,
            vault_get,
            vault_save,
            kh_list,
            kh_forget,
            sync_status,
            sync_set_folder,
            sync_set_local,
            gdrive_set_credentials,
            gdrive_connect,
            gdrive_disconnect,
            gdrive_push,
            gdrive_pull,
            ssh_open_shell,
            ssh_send,
            ssh_resize,
            ssh_close,
            sftp_list,
            sftp_download,
            sftp_upload,
            local_home,
            local_list,
            sftp_transfer,
            transfer_start,
            file_read_b64,
            file_rename,
            file_mkdir,
            file_delete,
            forward_start,
            forward_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
