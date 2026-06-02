import { FolderTree, Palette, Plus, Server, X } from "lucide-react";
import { useStore } from "../store/useStore";
import { TerminalView } from "./TerminalView";
import { SftpPanel } from "./panels/SftpPanel";
import { ThemePanel } from "./panels/ThemePanel";

export function Workspace() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const rightPanel = useStore((s) => s.rightPanel);
  const setRightPanel = useStore((s) => s.setRightPanel);
  const hosts = useStore((s) => s.vault.hosts);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const statusDot = (s: string) =>
    s === "connected"
      ? "bg-accent"
      : s === "connecting"
        ? "bg-warn animate-pulse-dot"
        : s === "error"
          ? "bg-danger"
          : "bg-content-faint";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg-inset">
      {/* tab bar */}
      <div className="flex h-11 shrink-0 items-center border-b border-line bg-bg-raised pr-2">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
          {tabs.map((t) => {
            const active = t.id === activeTabId;
            return (
              <div
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`group flex h-11 min-w-0 max-w-[200px] shrink-0 cursor-pointer items-center gap-2 border-r border-line px-3.5 text-sm transition-colors duration-200 ${
                  active
                    ? "bg-bg-inset text-content"
                    : "text-content-muted hover:bg-surface-hover hover:text-content"
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(t.status)}`} />
                <span className="truncate">{t.title}</span>
                <button
                  className="-mr-1 ml-1 rounded p-0.5 text-content-faint opacity-0 transition-opacity hover:bg-surface-active hover:text-content group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                  aria-label="Close tab"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          className={`btn-ghost ml-2 px-2 py-1.5 text-xs ${
            rightPanel === "themes" ? "bg-surface text-content" : ""
          }`}
          onClick={() => setRightPanel("themes")}
          title="Terminal themes"
        >
          <Palette size={15} />
        </button>

        {activeTab && (
          <button
            className={`btn-ghost ml-1 px-2 py-1.5 text-xs ${
              rightPanel === "sftp" ? "bg-surface text-content" : ""
            }`}
            onClick={() => setRightPanel("sftp")}
            title="Toggle SFTP file browser"
          >
            <FolderTree size={15} />
            SFTP
          </button>
        )}
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          {tabs.length === 0 ? (
            <EmptyState hasHosts={hosts.length > 0} />
          ) : (
            tabs.map((t) => (
              <div
                key={t.id}
                className="absolute inset-0"
                style={{ display: t.id === activeTabId ? "block" : "none" }}
              >
                <TerminalView tab={t} />
              </div>
            ))
          )}
        </div>

        {activeTab && rightPanel === "sftp" && (
          <div className="w-[380px] shrink-0 border-l border-line bg-bg">
            <SftpPanel hostId={activeTab.hostId} />
          </div>
        )}
        {rightPanel === "themes" && (
          <div className="w-[320px] shrink-0 border-l border-line bg-bg">
            <ThemePanel />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ hasHosts }: { hasHosts: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-content-faint">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface/60">
        {hasHosts ? <Server size={30} /> : <Plus size={30} />}
      </div>
      <p className="text-sm">
        {hasHosts ? "Double-click a host to open a session." : "Add a host from the sidebar to begin."}
      </p>
      <p className="font-mono text-xs text-content-faint/70">SSH · SFTP · Port Forwarding</p>
    </div>
  );
}
