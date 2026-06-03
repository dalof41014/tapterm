import { useState, type MouseEvent } from "react";
import { Bot, Check, Copy, FolderOpen, FolderTree, Palette, Pencil, Plus, Search, Server, SquarePlus, TerminalSquare, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store/useStore";
import { whichAvailable } from "../lib/api";
import { TerminalView } from "./TerminalView";
import { SftpPanel } from "./panels/SftpPanel";
import { ThemePanel } from "./panels/ThemePanel";
import { AiCommandPanel } from "./panels/AiCommandPanel";

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
  const [newConn, setNewConn] = useState<{ x: number; y: number } | null>(null);
  const [connQuery, setConnQuery] = useState("");
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number } | null>(null);
  const [aiInstalled, setAiInstalled] = useState<string[] | null>(null);
  const [aiTargetMode, setAiTargetMode] = useState<"local" | "remote">("local");
  const [aiTargetHost, setAiTargetHost] = useState<string | null>(null);
  const [aiHostQuery, setAiHostQuery] = useState("");
  const [aiCwd, setAiCwd] = useState("");
  const aiTools = useStore((s) => s.aiTools);

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

  const cq = connQuery.toLowerCase();
  const connHosts = cq
    ? hosts.filter(
        (h) =>
          h.label.toLowerCase().includes(cq) ||
          h.address.toLowerCase().includes(cq) ||
          h.username.toLowerCase().includes(cq) ||
          h.tags.some((t) => t.toLowerCase().includes(cq)),
      )
    : hosts;

  const openNewConn = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setConnQuery("");
    setNewConn({ x: r.left, y: r.bottom + 4 });
  };
  const sshHosts = hosts.filter((h) => h.protocol !== "telnet");
  const aiHq = aiHostQuery.toLowerCase();
  const aiHostList = aiHq
    ? sshHosts.filter(
        (h) =>
          h.label.toLowerCase().includes(aiHq) ||
          h.address.toLowerCase().includes(aiHq) ||
          h.username.toLowerCase().includes(aiHq),
      )
    : sshHosts;

  const openAiMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAiInstalled(null);
    setAiHostQuery("");
    setAiCwd("");
    // default target: the active remote session if any, otherwise local
    if (activeTab && activeTab.kind === "ssh" && activeTab.hostId) {
      setAiTargetMode("remote");
      setAiTargetHost(activeTab.hostId);
    } else {
      setAiTargetMode("local");
      setAiTargetHost(null);
    }
    setAiMenu({ x: r.left, y: r.bottom + 4 });
    whichAvailable(aiTools.map((t) => t.command))
      .then(setAiInstalled)
      .catch(() => setAiInstalled([]));
  };
  const browseAiCwd = async () => {
    try {
      const dir = await openDialog({ directory: true, multiple: false });
      if (typeof dir === "string") setAiCwd(dir);
    } catch {
      /* cancelled */
    }
  };
  const launchAi = (toolId: string, command: string, name: string) => {
    // optionally cd into the project folder first (the tool's working dir).
    // Quote only when the path has spaces so `~` still expands on remote shells.
    const cwd = aiCwd.trim();
    const q = cwd.includes(" ") ? `"${cwd}"` : cwd;
    const startup = cwd ? `cd ${q}\n${command}` : command;
    if (aiTargetMode === "local") {
      openLocal({ command: startup, title: name, aiTool: toolId });
    } else {
      if (!aiTargetHost) return;
      const h = hosts.find((x) => x.id === aiTargetHost);
      openHost(aiTargetHost, {
        command: startup,
        aiTool: toolId,
        title: h ? `${name} · ${h.label}` : name,
      });
    }
    if (rightPanel !== "ai") setRightPanel("ai");
    setAiMenu(null);
  };

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
            className={`btn-ghost ml-1 shrink-0 p-1.5 ${newConn ? "bg-surface text-content" : ""}`}
            onClick={openNewConn}
            title="New connection"
          >
            <SquarePlus size={16} />
          </button>
          <button
            className={`btn-ghost shrink-0 p-1.5 ${aiMenu ? "bg-surface text-content" : ""}`}
            onClick={openAiMenu}
            title="Launch an AI tool"
          >
            <Bot size={16} />
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

        {activeTab && activeTab.kind === "ssh" && (
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

        {activeTab?.aiTool && (
          <button
            className={`btn-ghost ml-1 px-2 py-1.5 text-xs ${
              rightPanel === "ai" ? "bg-surface text-content" : ""
            }`}
            onClick={() => setRightPanel("ai")}
            title="Toggle AI commands"
          >
            <Bot size={15} />
            Commands
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

        {activeTab && activeTab.kind === "ssh" && rightPanel === "sftp" && (
          <div className="w-[380px] shrink-0 border-l border-line bg-bg">
            <SftpPanel hostId={activeTab.hostId} />
          </div>
        )}
        {rightPanel === "themes" && (
          <div className="w-[320px] shrink-0 border-l border-line bg-bg">
            <ThemePanel />
          </div>
        )}
        {rightPanel === "ai" && activeTab?.aiTool && (
          <div className="w-[320px] shrink-0 border-l border-line bg-bg">
            <AiCommandPanel tab={activeTab} />
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

      {/* new-connection picker: local terminal + searchable hosts */}
      {newConn && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setNewConn(null)}
            onContextMenu={(e) => { e.preventDefault(); setNewConn(null); }}
          />
          <div
            className="fixed z-50 flex max-h-[60vh] w-72 flex-col overflow-hidden rounded-xl border border-line-strong bg-bg-raised shadow-2xl animate-fade-in"
            style={{ left: Math.min(newConn.x, window.innerWidth - 300), top: Math.min(newConn.y, window.innerHeight - 380) }}
          >
            <button
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-content transition-colors duration-150 hover:bg-surface-hover"
              onClick={() => { openLocal(); setNewConn(null); }}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface text-content-muted">
                <TerminalSquare size={15} />
              </span>
              <span className="font-medium">Local terminal</span>
            </button>
            <div className="border-t border-line px-2 py-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
                <input
                  autoFocus
                  className="input py-1.5 pl-8 text-xs"
                  placeholder="Search hosts…"
                  value={connQuery}
                  onChange={(e) => setConnQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setNewConn(null); }}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
              {connHosts.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-content-faint">No matches.</p>
              ) : (
                connHosts.map((h) => (
                  <button
                    key={h.id}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover"
                    onClick={() => { openHost(h.id); setNewConn(null); }}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold uppercase"
                      style={{ background: (h.color ?? "#22C55E") + "22", color: h.color ?? "#22C55E" }}
                    >
                      {h.label.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-content">{h.label}</span>
                      <span className="block truncate font-mono text-[11px] text-content-faint">
                        {h.username}@{h.address}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* AI tool launcher: opens a tagged local OR remote (ssh) session */}
      {aiMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setAiMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setAiMenu(null); }}
          />
          <div
            className="fixed z-50 flex max-h-[72vh] w-72 flex-col overflow-hidden rounded-xl border border-line-strong bg-bg-raised shadow-2xl animate-fade-in"
            style={{ left: Math.min(aiMenu.x, window.innerWidth - 300), top: Math.min(aiMenu.y, window.innerHeight - 120) }}
          >
            {/* target selector */}
            <div className="border-b border-line p-2">
              <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-content-faint">
                Run on
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => { setAiTargetMode("local"); setAiCwd(""); }}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    aiTargetMode === "local"
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line-strong text-content-muted hover:bg-surface-hover"
                  }`}
                >
                  Local
                </button>
                <button
                  onClick={() => { setAiTargetMode("remote"); setAiCwd(""); }}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    aiTargetMode === "remote"
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line-strong text-content-muted hover:bg-surface-hover"
                  }`}
                >
                  Remote host
                </button>
              </div>

              {aiTargetMode === "remote" && (
                <div className="mt-2">
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
                    <input
                      autoFocus
                      className="input py-1.5 pl-8 text-xs"
                      placeholder="Search hosts…"
                      value={aiHostQuery}
                      onChange={(e) => setAiHostQuery(e.target.value)}
                    />
                  </div>
                  <div className="mt-1.5 max-h-40 overflow-y-auto">
                    {aiHostList.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-content-faint">No SSH hosts.</p>
                    ) : (
                      aiHostList.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => setAiTargetHost(h.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                            aiTargetHost === h.id ? "bg-accent-soft" : "hover:bg-surface-hover"
                          }`}
                        >
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold uppercase"
                            style={{ background: (h.color ?? "#22C55E") + "22", color: h.color ?? "#22C55E" }}
                          >
                            {h.label.slice(0, 2)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-content">{h.label}</span>
                            <span className="block truncate font-mono text-[10px] text-content-faint">
                              {h.username}@{h.address}
                            </span>
                          </span>
                          {aiTargetHost === h.id && <Check size={14} className="shrink-0 text-accent" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* project folder (the tool's working directory) */}
            <div className="border-b border-line p-2">
              <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-content-faint">
                Project folder · optional
              </div>
              <div className="flex gap-1.5">
                <input
                  className="input py-1.5 text-xs"
                  placeholder={aiTargetMode === "remote" ? "~/project or /srv/app" : "Project path"}
                  value={aiCwd}
                  onChange={(e) => setAiCwd(e.target.value)}
                />
                {aiTargetMode === "local" && (
                  <button
                    className="btn-surface shrink-0 px-2 py-1.5 text-xs"
                    onClick={browseAiCwd}
                    title="Browse for a folder"
                  >
                    <FolderOpen size={14} />
                  </button>
                )}
              </div>
              <p className="mt-1 px-1 text-[10px] text-content-faint">
                The tool starts in this directory (its project). Leave empty for the default.
              </p>
            </div>

            {/* tool list */}
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-faint">
                AI tools
              </div>
              {aiTargetMode === "remote" && !aiTargetHost && (
                <p className="px-3 py-2 text-xs text-content-faint">Pick a host above first.</p>
              )}
              {aiTools.map((t) => {
                // installed status only reflects the local machine's PATH
                const installed = aiTargetMode !== "local" || aiInstalled === null
                  ? null
                  : aiInstalled.includes(t.command);
                const disabled = aiTargetMode === "remote" && !aiTargetHost;
                return (
                  <button
                    key={t.id}
                    disabled={disabled}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-content transition-colors duration-150 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => launchAi(t.id, t.command, t.name)}
                  >
                    <Bot size={15} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="block truncate font-mono text-[10px] text-content-faint">
                        {t.command}{installed === false ? " · not on PATH" : ""}
                      </span>
                    </span>
                    {installed !== null && (
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${installed ? "bg-emerald-500" : "bg-content-faint/40"}`}
                        title={installed ? "Installed" : "Not found on PATH"}
                      />
                    )}
                  </button>
                );
              })}
            </div>
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
      <button className="btn-surface mt-1 px-3 py-1.5 text-xs" onClick={() => openLocal()}>
        <TerminalSquare size={14} /> Open local terminal
      </button>
      <p className="font-mono text-xs text-content-faint/70">SSH · SFTP · Port Forwarding</p>
    </div>
  );
}
