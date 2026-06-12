import { useEffect, useState } from "react";
import { useStore } from "./store/useStore";
import { gdrivePull, syncStatus, vaultAutounlock } from "./lib/api";
import { VaultGate } from "./components/VaultGate";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { FileManager } from "./components/FileManager";
import { HostsPage } from "./components/HostsPage";
import { TitleBar } from "./components/TitleBar";
import { UpdateToast } from "./components/UpdateToast";
import { QuickSwitch } from "./components/QuickSwitch";

export default function App() {
  const status = useStore((s) => s.status);
  const mainView = useStore((s) => s.mainView);
  const refreshStatus = useStore((s) => s.refreshStatus);
  const setGdriveConnected = useStore((s) => s.setGdriveConnected);
  const setNoPassword = useStore((s) => s.setNoPassword);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await syncStatus();
        setGdriveConnected(s.gdriveConnected);
        // pull the latest encrypted vault from Drive before unlocking
        if (s.gdriveConnected) {
          await gdrivePull().catch(() => {});
        }
        // auto-unlock no-password vaults (detected from the vault file itself,
        // so a no-password vault synced from another device works here too)
        await vaultAutounlock().catch(() => false);
        // re-read in case auto-unlock flipped the local no-password flag
        setNoPassword((await syncStatus()).noPassword);
      } catch {
        /* ignore */
      }
      await refreshStatus();
      setBooted(true);
    })();
  }, [refreshStatus, setGdriveConnected, setNoPassword]);

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const ae = document.activeElement as HTMLElement | null;
      const inField =
        !!ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "SELECT" ||
          (ae.tagName === "TEXTAREA" && !ae.classList.contains("xterm-helper-textarea")));
      if (inField) return;

      const s = useStore.getState();
      const k = e.key.toLowerCase();
      let handled = true;
      if (k === "b") s.toggleSidebar();
      else if (k === "t" && !e.shiftKey) s.openLocal();
      else if (k === "p" && !e.shiftKey) s.setQuickOpen(true);
      else if (k === ",") s.setSettingsOpen(!s.settingsOpen);
      else if (k === "w" && e.shiftKey) {
        if (s.activeTabId) s.closeTab(s.activeTabId);
      } else if (k === "tab") {
        const { tabs, activeTabId } = s;
        if (tabs.length) {
          const i = tabs.findIndex((t) => t.id === activeTabId);
          const n = e.shiftKey ? (i - 1 + tabs.length) % tabs.length : (i + 1) % tabs.length;
          s.setActiveTab(tabs[n].id);
        }
      } else if (k >= "1" && k <= "9") {
        const t = s.tabs[parseInt(k, 10) - 1];
        if (t) s.setActiveTab(t.id);
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!booted) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-content-muted">
        <span className="font-mono text-sm">Loading…</span>
      </div>
    );
  }

  const unlocked = status?.unlocked;

  return (
    <div className="flex h-full flex-col bg-bg text-content">
      <TitleBar />
      {!unlocked ? (
        <VaultGate />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {/* Workspace stays mounted so terminal sessions survive view switches */}
          <div
            className="flex min-h-0 min-w-0 flex-1"
            style={{ display: mainView === "terminals" ? "flex" : "none" }}
          >
            <Workspace />
          </div>
          {mainView === "files" && <FileManager />}
          {mainView === "hosts" && <HostsPage />}
        </div>
      )}
      <UpdateToast />
      {unlocked && <QuickSwitch />}
    </div>
  );
}
