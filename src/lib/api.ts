import { invoke } from "@tauri-apps/api/core";
import type { KnownHost, SftpListing, SyncStatus, VaultData, VaultStatus } from "./types";

// ---- vault ----
export const vaultStatus = () => invoke<VaultStatus>("vault_status");
export const vaultInit = (password: string) => invoke<void>("vault_init", { password });
export const vaultInitNopass = () => invoke<void>("vault_init_nopass");
export const vaultAutounlock = () => invoke<boolean>("vault_autounlock");
export const vaultUnlock = (password: string) => invoke<void>("vault_unlock", { password });
export const vaultLock = () => invoke<void>("vault_lock");
export const vaultGet = () => invoke<VaultData>("vault_get");
export const vaultSave = (data: VaultData) => invoke<void>("vault_save", { data });

// ---- known hosts ----
export const khList = () => invoke<KnownHost[]>("kh_list");
export const khForget = (host: string) => invoke<void>("kh_forget", { host });

// ---- sync ----
export const syncStatus = () => invoke<SyncStatus>("sync_status");
export const syncSetFolder = (folder: string) => invoke<SyncStatus>("sync_set_folder", { folder });
export const syncSetLocal = () => invoke<SyncStatus>("sync_set_local");

// ---- google drive sync ----
export const gdriveSetCredentials = (clientId: string, clientSecret: string) =>
  invoke<SyncStatus>("gdrive_set_credentials", { clientId, clientSecret });
export const gdriveConnect = () => invoke<SyncStatus>("gdrive_connect");
export const gdriveDisconnect = () => invoke<SyncStatus>("gdrive_disconnect");
export const gdrivePush = () => invoke<void>("gdrive_push");
export const gdrivePull = () => invoke<void>("gdrive_pull");

// ---- ssh shell ----
export const sshOpenShell = (id: string, hostId: string, cols: number, rows: number) =>
  invoke<void>("ssh_open_shell", { id, hostId, cols, rows });
export const sshSend = (id: string, data: string) => invoke<void>("ssh_send", { id, data });
export const sshResize = (id: string, cols: number, rows: number) =>
  invoke<void>("ssh_resize", { id, cols, rows });
export const sshClose = (id: string) => invoke<void>("ssh_close", { id });

// ---- sftp ----
export const sftpList = (hostId: string, path: string) =>
  invoke<SftpListing>("sftp_list", { hostId, path });
export const sftpDownload = (hostId: string, remote: string, local: string) =>
  invoke<number>("sftp_download", { hostId, remote, local });
export const sftpUpload = (hostId: string, local: string, remote: string) =>
  invoke<number>("sftp_upload", { hostId, local, remote });

// ---- port forwarding ----
export const forwardStart = (
  id: string,
  hostId: string,
  bindAddress: string,
  bindPort: number,
  destHost: string,
  destPort: number,
) =>
  invoke<void>("forward_start", {
    id,
    hostId,
    bindAddress,
    bindPort,
    destHost,
    destPort,
  });
export const forwardStop = (id: string) => invoke<void>("forward_stop", { id });
