import { useState } from "react";
import { Copy, FolderTree, Palette, Pencil, Plus, Server, SquarePlus, TerminalSquare, X } from "lucide-react";
import { useStore } from "../store/useStore";
import { TerminalView } from "./TerminalView";
import { SftpPanel } from "./panels/SftpPanel";
import { ThemePanel } from "./panels/ThemePanel";

export function Workspace() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const openLocal = useStore((s) => s.openLocal);
  const openHost = useStore((s) => s.openHost);
  const renameTab = useStore((s) => s.renameTab);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  const startRename = (id: string, current: string) => setEditing({ id, value: current });
  const commitRename = () => {
    if (editing) renameTab(editing.id, editing.value.trim() || "Terminal");
    setEditing(null);
  };
  const duplicateTab = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    if (t.kind === "local") openLocal();
    else openHost(t.hostId);
  };
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
                onDoubleClick={() => startRename(t.id, t.title)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveTab(t.id);
                  setTabMenu({ x: e.clientX, y: e.clientY, id: t.id });
                }}
                className={`group flex h-11 min-w-0 max-w-[200px] shrink-0 cursor-pointer items-center gap-2 border-r border-line px-3.5 text-sm transition-colors duration-200 ${
                  active
                    ? "bg-bg-inset text-content"
                    : "text-content-muted hover:bg-surface-hover hover:text-content"
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(t.status)}`} />
                {editing?.id === t.id ? (
                  <input
                    autoFocus
                    value={editing.value}
                    onChange={(e) => setEditing({ id: t.id, value: e.target.value })}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="min-w-0 flex-1 rounded bg-bg-inset px-1 py-0.5 text-sm text-content outline-none ring-1 ring-accent"
                  />
                ) : (
                  <span className="truncate">{t.title}</span>
                )}
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
          <button
            className="btn-ghost ml-1 shrink-0 p-1.5"
            onClick={openLocal}
            title="New local terminal"
          >
            <SquarePlus size={16} />
          </button>
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

      {/* tab context menu */}
      {tabMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTabMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTabMenu(null); }} />
          <div
            className="fixed z-50 w-44 overflow-hidden rounded-xl border border-line-strong bg-bg-raised py-1 shadow-2xl animate-fade-in"
            style={{ left: Math.min(tabMenu.x, window.innerWidth - 180), top: Math.min(tabMenu.y, window.innerHeight - 140) }}
          >
            <button
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-content transition-colors duration-150 hover:bg-surface-hover"
              onClick={() => {
                const t = tabs.find((x) => x.id === tabMenu.id);
                setTabMenu(null);
                if (t) startRename(t.id, t.title);
              }}
            >
              <Pencil size={15} /> Rename
            </button>
            <button
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-content transition-colors duration-150 hover:bg-surface-hover"
              onClick={() => { duplicateTab(tabMenu.id); setTabMenu(null); }}
            >
              <Copy size={15} /> Duplicate
            </button>
            <button
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-danger transition-colors duration-150 hover:bg-danger/10"
              onClick={() => { closeTab(tabMenu.id); setTabMenu(null); }}
            >
              <X size={15} /> Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ hasHosts }: { hasHosts: boolean }) {
  const openLocal = useStore((s) => s.openLocal);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-content-faint">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface/60">
        {hasHosts ? <Server size={30} /> : <Plus size={30} />}
      </div>
      <p className="text-sm">
        {hasHosts ? "Double-click a host to open a session." : "Add a host from the sidebar to begin."}
      </p>
      <button className="btn-surface mt-1 px-3 py-1.5 text-xs" onClick={openLocal}>
        <TerminalSquare size={14} /> Open local terminal
      </button>
      <p className="font-mono text-xs text-content-faint/70">SSH · SFTP · Port Forwarding</p>
    </div>
  );
}
