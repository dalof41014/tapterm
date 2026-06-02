import { useCallback, useEffect, useState } from "react";
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  FolderSync,
  HardDrive,
  Link2,
  Link2Off,
  RefreshCw,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Modal } from "../ui/Modal";
import { PasswordInput } from "../ui/PasswordInput";
import {
  gdriveConnect,
  gdriveDisconnect,
  gdrivePull,
  gdrivePush,
  gdriveSetCredentials,
  syncSetFolder,
  syncSetLocal,
  syncStatus,
} from "../../lib/api";
import { useStore } from "../../store/useStore";
import type { SyncStatus } from "../../lib/types";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const refreshStatus = useStore((s) => s.refreshStatus);
  const setGdriveConnected = useStore((s) => s.setGdriveConnected);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // google credentials inputs
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showCreds, setShowCreds] = useState(false);

  const load = useCallback(async () => {
    const s = await syncStatus();
    setSync(s);
    setGdriveConnected(s.gdriveConnected);
    setShowCreds(!s.gdriveHasCredentials);
  }, [setGdriveConnected]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, refresh = true) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      if (refresh) await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const chooseFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (!dir || typeof dir !== "string") return;
    await run("folder", () => syncSetFolder(dir));
  };

  const connectDrive = async () => {
    await run("connect", async () => {
      if (clientId && clientSecret) await gdriveSetCredentials(clientId, clientSecret);
      await gdriveConnect();
    });
  };

  const mode = sync?.mode ?? "local";

  return (
    <Modal title="Settings" subtitle="Cloud sync & preferences" width="max-w-xl" onClose={onClose}>
      {error && (
        <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <section className="mb-6">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-content">
          <Cloud size={16} className="text-accent" /> Vault sync
        </h3>
        <p className="mb-4 text-xs text-content-muted">
          The vault is end-to-end encrypted, so the cloud only stores ciphertext. Use the same master
          password on each device to decrypt it.
        </p>

        <div className="space-y-2">
          {/* Local */}
          <button
            onClick={() => run("local", syncSetLocal)}
            disabled={!!busy}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-200 cursor-pointer ${
              mode === "local" ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-surface-hover"
            }`}
          >
            <HardDrive size={18} className="mt-0.5 shrink-0 text-content-muted" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-content">This device only</div>
              <div className="text-xs text-content-faint">No sync — vault stays in the local app data folder.</div>
            </div>
          </button>

          {/* Folder */}
          <div className={`rounded-xl border p-3 ${mode === "folder" ? "border-accent bg-accent-soft" : "border-line-strong"}`}>
            <div className="flex items-start gap-3">
              <FolderSync size={18} className="mt-0.5 shrink-0 text-content-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-content">Synced folder</div>
                <div className="text-xs text-content-faint">
                  Keep the vault inside your Google Drive / Dropbox / OneDrive desktop folder; the sync
                  client mirrors it to every device.
                </div>
                {mode === "folder" && sync?.folderPath && (
                  <code className="mt-2 block truncate rounded bg-bg-inset px-2 py-1 font-mono text-[10px] text-accent">
                    {sync.folderPath}
                  </code>
                )}
                <button className="btn-surface mt-2 px-3 py-1.5 text-xs" onClick={chooseFolder} disabled={!!busy}>
                  {busy === "folder" ? <RefreshCw size={13} className="animate-spin" /> : <FolderSync size={13} />}
                  {mode === "folder" ? "Change folder…" : "Choose folder…"}
                </button>
              </div>
            </div>
          </div>

          {/* Google Drive (API) */}
          <div className={`rounded-xl border p-3 ${mode === "gdrive" ? "border-accent bg-accent-soft" : "border-line-strong"}`}>
            <div className="flex items-start gap-3">
              <Cloud size={18} className="mt-0.5 shrink-0 text-content-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-content">Google Drive (built-in)</div>
                <div className="text-xs text-content-faint">
                  Sign in with Google; the encrypted vault is stored in Drive's hidden app folder.
                </div>

                {sync?.gdriveConnected ? (
                  <div className="mt-2">
                    <div className="chip mb-2 bg-accent-soft text-accent">
                      Connected{sync.gdriveEmail ? ` · ${sync.gdriveEmail}` : ""}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-surface px-3 py-1.5 text-xs" onClick={() => run("push", gdrivePush, false)} disabled={!!busy}>
                        {busy === "push" ? <RefreshCw size={13} className="animate-spin" /> : <CloudUpload size={13} />}
                        Push now
                      </button>
                      <button className="btn-surface px-3 py-1.5 text-xs" onClick={() => run("pull", gdrivePull)} disabled={!!busy}>
                        {busy === "pull" ? <RefreshCw size={13} className="animate-spin" /> : <CloudDownload size={13} />}
                        Pull now
                      </button>
                      <button className="btn-ghost px-3 py-1.5 text-xs hover:text-danger" onClick={() => run("disc", gdriveDisconnect)} disabled={!!busy}>
                        <Link2Off size={13} /> Disconnect
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    {showCreds && (
                      <div className="mb-2 space-y-2">
                        <input
                          className="input py-1.5 text-xs"
                          placeholder="Google OAuth Client ID"
                          value={clientId}
                          onChange={(e) => setClientId(e.target.value)}
                        />
                        <PasswordInput
                          className="input py-1.5 text-xs"
                          placeholder="Client Secret"
                          value={clientSecret}
                          onChange={(e) => setClientSecret(e.target.value)}
                        />
                        <p className="text-[10px] text-content-faint">
                          Create a “Desktop app” OAuth client in Google Cloud Console, enable the Drive
                          API, and paste the credentials here. They are stored locally.
                        </p>
                      </div>
                    )}
                    <button className="btn-primary px-3 py-1.5 text-xs" onClick={connectDrive} disabled={!!busy}>
                      {busy === "connect" ? <RefreshCw size={13} className="animate-spin" /> : <Link2 size={13} />}
                      Connect Google Drive
                    </button>
                    {!showCreds && (
                      <button className="btn-ghost ml-2 px-2 py-1.5 text-xs" onClick={() => setShowCreds(true)}>
                        Change credentials
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 rounded-lg bg-bg-inset px-3 py-2 font-mono text-[10px] text-content-faint">
          Vault file: {sync?.vaultPath ?? "…"}
        </p>
        <p className="mt-2 text-[11px] text-content-faint">
          Switching location or pulling from the cloud locks the vault — you'll re-enter your master
          password against the new file.
        </p>
      </section>
    </Modal>
  );
}
