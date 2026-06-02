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
        setNoPassword(s.noPassword);
        // pull the latest encrypted vault from Drive before unlocking
        if (s.gdriveConnected) {
          await gdrivePull().catch(() => {});
        }
        // if the vault has no master password, unlock it silently
        if (s.noPassword) {
          await vaultAutounlock().catch(() => false);
        }
      } catch {
        /* ignore */
      }
      await refreshStatus();
      setBooted(true);
    })();
  }, [refreshStatus, setGdriveConnected, setNoPassword]);

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
          {mainView === "files" ? (
            <FileManager />
          ) : mainView === "hosts" ? (
            <HostsPage />
          ) : (
            <Workspace />
          )}
        </div>
      )}
      <UpdateToast />
    </div>
  );
}
