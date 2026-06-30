import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Cloud,
  CloudUpload,
  CloudDownload,
  Download,
  FolderSync,
  HardDrive,
  Keyboard,
  Link2,
  Link2Off,
  Lock,
  Plus,
  RefreshCw,
  TerminalSquare,
  Trash2,
  Unlock,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, downloadAndApply } from "../../lib/updater";
import { FONTS } from "../../lib/fonts";
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
  vaultRemovePassword,
  vaultSetPassword,
} from "../../lib/api";
import { AI_ENABLED } from "../../lib/aiTools";
import { useStore } from "../../store/useStore";
import type { SyncStatus } from "../../lib/types";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const refreshStatus = useStore((s) => s.refreshStatus);
  const setGdriveConnected = useStore((s) => s.setGdriveConnected);
  const setNoPassword = useStore((s) => s.setNoPassword);
  const localFontId = useStore((s) => s.localFontId);
  const setLocalFont = useStore((s) => s.setLocalFont);
  const aiTools = useStore((s) => s.aiTools);
  const addAiTool = useStore((s) => s.addAiTool);
  const removeAiTool = useStore((s) => s.removeAiTool);
  const [aiName, setAiName] = useState("");
  const [aiCmd, setAiCmd] = useState("");
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // google credentials inputs
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showCreds, setShowCreds] = useState(false);

  // security
  const [newPw, setNewPw] = useState("");
  const [showPwInput, setShowPwInput] = useState(false);

  // updates
  const [version, setVersion] = useState("");
  const [upState, setUpState] = useState<"idle" | "checking" | "none" | "available" | "installing">(
    "idle",
  );
  const [upObj, setUpObj] = useState<Update | null>(null);
  const [upPct, setUpPct] = useState<number | null>(null);

  const load = useCallback(async () => {
    const s = await syncStatus();
    setSync(s);
    setGdriveConnected(s.gdriveConnected);
    setNoPassword(s.noPassword);
    setShowCreds(!s.gdriveHasCredentials);
  }, [setGdriveConnected, setNoPassword]);

  useEffect(() => {
    load();
    getVersion().then(setVersion).catch(() => {});
  }, [load]);

  const checkUpdate = async () => {
    setUpState("checking");
    const u = await checkForUpdate();
    if (u) {
      setUpObj(u);
      setUpState("available");
    } else {
      setUpState("none");
    }
  };

  const installUpdate = async () => {
    if (!upObj) return;
    setUpState("installing");
    try {
      await downloadAndApply(upObj, (p) => {
        if (p.total) setUpPct(Math.round((p.downloaded / p.total) * 100));
      });
    } catch (e) {
      setError("Update failed: " + String(e));
      setUpState("available");
    }
  };

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

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-content">
          {sync?.noPassword ? (
            <Unlock size={16} className="text-warn" />
          ) : (
            <Lock size={16} className="text-accent" />
          )}
          Master password
        </h3>

        {sync?.noPassword ? (
          <>
            <p className="mb-3 text-xs text-content-muted">
              Auto-unlock is <span className="text-warn">on</span> — the app opens without asking for a
              password. The vault is encrypted with a built-in key (obfuscated, not password-protected).
            </p>
            {showPwInput ? (
              <div className="flex items-center gap-2">
                <PasswordInput
                  className="input py-1.5 text-xs"
                  placeholder="New master password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
                <button
                  className="btn-primary shrink-0 px-3 py-1.5 text-xs"
                  disabled={newPw.length < 4 || !!busy}
                  onClick={() =>
                    run("setpw", async () => {
                      await vaultSetPassword(newPw);
                      setNewPw("");
                      setShowPwInput(false);
                    })
                  }
                >
                  Set password
                </button>
              </div>
            ) : (
              <button className="btn-surface px-3 py-1.5 text-xs" onClick={() => setShowPwInput(true)}>
                <Lock size={13} /> Set a master password
              </button>
            )}
          </>
        ) : (
          <>
            <p className="mb-3 text-xs text-content-muted">
              A master password is required every time the app launches. Remove it to auto-unlock on
              this device (less secure — anyone with this app can open your vault).
            </p>
            <button
              className="btn-surface px-3 py-1.5 text-xs hover:text-warn"
              disabled={!!busy}
              onClick={() => {
                if (confirm("Remove the master password? The app will auto-unlock on launch.")) {
                  run("rmpw", vaultRemovePassword);
                }
              }}
            >
              {busy === "rmpw" ? <RefreshCw size={13} className="animate-spin" /> : <Unlock size={13} />}
              Remove master password (auto-unlock)
            </button>
          </>
        )}
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-content">
          <TerminalSquare size={16} className="text-accent" /> Local terminal
        </h3>
        <label className="label">Font</label>
        <select
          className="input"
          value={localFontId}
          onChange={(e) => setLocalFont(e.target.value)}
          style={{ fontFamily: FONTS.find((f) => f.id === localFontId)?.family }}
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
              {f.name}
            </option>
          ))}
        </select>
        <p
          className="mt-2 rounded bg-bg-inset px-2 py-1.5 text-[13px] text-content-muted"
          style={{ fontFamily: FONTS.find((f) => f.id === localFontId)?.family }}
        >
          {`const x = () => { return 0 == 1; }; // 0O1lI`}
        </p>
        <p className="mt-2 text-[11px] text-content-faint">
          Applies to local shell tabs. SSH hosts use the default font (Appearance panel) or their own
          per-host override.
        </p>
      </section>

      {AI_ENABLED && (
      <section className="mt-6 border-t border-line pt-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-content">
          <Bot size={16} className="text-accent" /> AI tools
        </h3>
        <p className="mb-3 text-xs text-content-muted">
          Launch these from the <Bot size={12} className="inline align-text-bottom" /> button in the tab
          bar — Tapterm runs the CLI in a local terminal and shows its commands in a side panel. No API
          keys are stored; each tool signs in through your shell environment.
        </p>
        <div className="space-y-1.5">
          {aiTools.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2.5 rounded-lg border border-line-strong px-3 py-2"
            >
              <Bot size={15} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-content">{t.name}</div>
                <div className="truncate font-mono text-[11px] text-content-faint">{t.command}</div>
              </div>
              {t.builtin ? (
                <span className="chip shrink-0">built-in</span>
              ) : (
                <button
                  className="btn-ghost p-1 hover:text-danger"
                  title="Remove"
                  onClick={() => removeAiTool(t.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="input py-1.5 text-xs"
            placeholder="Name (e.g. Aider)"
            value={aiName}
            onChange={(e) => setAiName(e.target.value)}
          />
          <input
            className="input py-1.5 font-mono text-xs"
            placeholder="command (e.g. aider)"
            value={aiCmd}
            onChange={(e) => setAiCmd(e.target.value)}
          />
          <button
            className="btn-surface shrink-0 px-3 py-1.5 text-xs"
            disabled={!aiCmd.trim()}
            onClick={() => {
              addAiTool(aiName.trim(), aiCmd.trim());
              setAiName("");
              setAiCmd("");
            }}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </section>
      )}

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-content">
          <Download size={16} className="text-accent" /> Updates
        </h3>
        <p className="mb-3 text-xs text-content-muted">
          Tapterm {version && <span className="font-mono">v{version}</span>}
        </p>

        {upState === "available" ? (
          <div>
            <div className="chip mb-2 bg-accent-soft text-accent">
              v{upObj?.version} available
            </div>
            {upObj?.body && (
              <p className="mb-2 line-clamp-3 text-xs text-content-muted">{upObj.body.trim()}</p>
            )}
            <button className="btn-primary px-3 py-1.5 text-xs" onClick={installUpdate}>
              <Download size={13} /> Install & restart
            </button>
          </div>
        ) : upState === "installing" ? (
          <div className="flex items-center gap-2 text-xs text-content-muted">
            <RefreshCw size={13} className="animate-spin" />
            {upPct !== null ? `Downloading ${upPct}%…` : "Installing…"}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button className="btn-surface px-3 py-1.5 text-xs" onClick={checkUpdate} disabled={upState === "checking"}>
              {upState === "checking" ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Check for updates
            </button>
            {upState === "none" && <span className="text-xs text-content-faint">You're up to date.</span>}
          </div>
        )}
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-content">
          <Keyboard size={16} className="text-accent" /> Keyboard shortcuts
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          {[
            ["Toggle sidebar", "Ctrl Shift / ⌘ B"],
            ["Quick switch session", "Ctrl Shift / ⌘ P"],
            ["New local terminal", "Ctrl Shift / ⌘ T"],
            ["Close tab", "Ctrl Shift / ⌘ W"],
            ["Switch to tab 1–9", "Ctrl/⌘ 1–9"],
            ["Next / prev tab", "Ctrl (Shift) Tab"],
            ["Settings", "Ctrl/⌘ ,"],
            ["Copy / paste (terminal)", "Ctrl/⌘ Shift C / V"],
            ["Find in terminal", "Ctrl/⌘ F"],
          ].map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-content-muted">{label}</span>
              <kbd className="shrink-0 rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] text-content-faint">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-content-faint">
          When a terminal is focused, plain Ctrl keys pass straight through — so the
          tmux prefix (Ctrl-B) and shell shortcuts (Ctrl-A/E/U/R…) work normally.
        </p>
      </section>
    </Modal>
  );
}
