mod gdrive;
mod ssh;
mod sync;
mod vault;

use sync::GDriveConfig;

use std::sync::Arc;

use ssh::{ConnectParams, SftpListing, SshManager};
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
    let (host, auth) = map_err(state.vault.resolve_host(host_id))?;
    Ok(ConnectParams {
        address: host.address,
        port: host.port,
        username: host.username,
        auth,
        cols,
        rows,
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

// ---------- port forwarding ----------

#[tauri::command]
async fn forward_start(
    state: State<'_, AppState>,
    id: String,
    host_id: String,
    bind_address: String,
    bind_port: u16,
    dest_host: String,
    dest_port: u16,
) -> Result<(), String> {
    let params = params_for(&state, &host_id, 80, 24)?;
    map_err(
        state
            .ssh
            .start_local_forward(id, params, bind_address, bind_port, dest_host, dest_port)
            .await,
    )
}

#[tauri::command]
async fn forward_stop(state: State<'_, AppState>, id: String) -> Result<(), String> {
    map_err(state.ssh.stop_forward(&id).await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            forward_start,
            forward_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
