import { getCurrentWindow } from "@tauri-apps/api/window";
import { Lock, Minus, Settings, Square, TerminalSquare, X } from "lucide-react";
import { useStore } from "../store/useStore";
import { vaultLock } from "../lib/api";
import { SettingsModal } from "./modals/SettingsModal";

export function TitleBar() {
  const status = useStore((s) => s.status);
  const noPassword = useStore((s) => s.noPassword);
  const refreshStatus = useStore((s) => s.refreshStatus);
  const clearTabs = useStore((s) => s.clearTabs);
  const appWin = getCurrentWindow();
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const onLock = async () => {
    clearTabs();
    await vaultLock();
    await refreshStatus();
  };

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 select-none items-center justify-between border-b border-line bg-bg-raised pl-3 pr-2"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-content">
        <TerminalSquare size={18} className="text-accent" />
        <span data-tauri-drag-region className="text-sm font-semibold tracking-tight">
          Tap<span className="text-accent">term</span>
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          className="btn-ghost p-1.5"
          onClick={() => setSettingsOpen(true)}
          title="Settings & sync"
          aria-label="Settings"
        >
          <Settings size={15} />
        </button>
        {status?.unlocked && !noPassword && (
          <button className="btn-ghost mr-1 px-2 py-1 text-xs" onClick={onLock} title="Lock vault">
            <Lock size={14} />
            Lock
          </button>
        )}
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        <button className="btn-ghost p-1.5" onClick={() => appWin.minimize()} aria-label="Minimize">
          <Minus size={15} />
        </button>
        <button
          className="btn-ghost p-1.5"
          onClick={() => appWin.toggleMaximize()}
          aria-label="Maximize"
        >
          <Square size={13} />
        </button>
        <button
          className="btn-ghost p-1.5 hover:bg-danger hover:text-white"
          onClick={() => appWin.close()}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
