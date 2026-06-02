//! Sync configuration. The vault is end-to-end encrypted, so "cloud sync" only
//! ever moves the ciphertext envelope around.
//!
//! Modes:
//! - `local`  — vault lives in the OS data dir (default, no sync).
//! - `folder` — vault lives in a user-chosen folder (e.g. the Google Drive /
//!              Dropbox / OneDrive desktop sync folder); the OS client syncs it.
//! - `gdrive` — vault stays local but is pushed/pulled to Google Drive's hidden
//!              app-data area via the Drive API.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GDriveConfig {
    pub client_id: String,
    pub client_secret: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub file_id: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub folder_path: Option<String>,
    #[serde(default)]
    pub gdrive: Option<GDriveConfig>,
    /// Vault was created without a user password (auto-unlocks on launch).
    #[serde(default)]
    pub no_password: bool,
}

fn default_mode() -> String {
    "local".to_string()
}

impl Default for SyncConfig {
    fn default() -> Self {
        SyncConfig {
            mode: default_mode(),
            folder_path: None,
            gdrive: None,
            no_password: false,
        }
    }
}

pub fn set_no_password(value: bool) -> anyhow::Result<()> {
    let mut cfg = load();
    cfg.no_password = value;
    save(&cfg)
}

pub fn config_path() -> PathBuf {
    let mut d = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    d.push("Terminal");
    d.push("sync.json");
    d
}

pub fn load() -> SyncConfig {
    std::fs::read(config_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(cfg: &SyncConfig) -> anyhow::Result<()> {
    let p = config_path();
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(p, serde_json::to_vec_pretty(cfg)?)?;
    Ok(())
}

pub fn default_vault_path() -> PathBuf {
    let mut d = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    d.push("Terminal");
    d.push("vault.json");
    d
}

/// Where the ciphertext vault file should live for a given config.
pub fn resolve_vault_path(cfg: &SyncConfig) -> PathBuf {
    match cfg.mode.as_str() {
        "folder" => cfg
            .folder_path
            .clone()
            .map(PathBuf::from)
            .unwrap_or_else(default_vault_path),
        // "local" and "gdrive" both keep the file in the default location
        _ => default_vault_path(),
    }
}

/// Public, secret-free view for the UI.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub mode: String,
    pub vault_path: String,
    pub folder_path: Option<String>,
    pub gdrive_connected: bool,
    pub gdrive_email: Option<String>,
    pub gdrive_has_credentials: bool,
    pub no_password: bool,
}

pub fn status(cfg: &SyncConfig) -> SyncStatus {
    SyncStatus {
        mode: cfg.mode.clone(),
        vault_path: resolve_vault_path(cfg).to_string_lossy().to_string(),
        folder_path: cfg.folder_path.clone(),
        gdrive_connected: cfg.gdrive.as_ref().map(|g| g.connected).unwrap_or(false),
        gdrive_email: cfg.gdrive.as_ref().and_then(|g| g.email.clone()),
        gdrive_has_credentials: cfg
            .gdrive
            .as_ref()
            .map(|g| !g.client_id.is_empty())
            .unwrap_or(false),
        no_password: cfg.no_password,
    }
}
