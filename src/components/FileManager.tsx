import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUp,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  File as FileIcon,
  FolderPlus,
  Folder,
  HardDrive,
  Image as ImageIcon,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { nanoid } from "nanoid";
import {
  fileDelete,
  fileMkdir,
  fileReadB64,
  fileRename,
  localList,
  sftpList,
  transferStart,
} from "../lib/api";
import { useStore } from "../store/useStore";
import type { Host, SftpEntry } from "../lib/types";

const DND_TYPE = "application/x-termfile";
const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"];

const ext = (n: string) => (n.lastIndexOf(".") >= 0 ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "");
const isImage = (n: string) => IMG_EXT.includes(ext(n));
function mimeOf(name: string) {
  const e = ext(name);
  if (e === "svg") return "image/svg+xml";
  if (e === "jpg") return "image/jpeg";
  if (e === "ico") return "image/x-icon";
  return `image/${e}`;
}
const sepOf = (p: string) => (p.includes("\\") && !p.includes("/") ? "\\" : "/");
function joinPath(cwd: string, name: string) {
  if (!cwd) return name;
  const s = sepOf(cwd);
  return cwd.endsWith(s) ? cwd + name : cwd + s + name;
}
function parentPath(cwd: string) {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx <= 0) return cwd.includes("\\") ? trimmed.slice(0, idx + 1) || trimmed : "/";
  return trimmed.slice(0, idx);
}
const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

type Side = "left" | "right";

interface PaneState {
  endpoint: string;
  hostId: string | null;
  cwd: string;
  entries: SftpEntry[];
  loading: boolean;
  error: string | null;
  selected: Set<string>;
  hideHidden: boolean;
  toggleHidden: () => void;
  setEndpoint: (v: string) => void;
  handleClick: (index: number, ctrl: boolean, shift: boolean) => void;
  selectAll: () => void;
  clearSel: () => void;
  selectedEntries: () => SftpEntry[];
  load: (path: string) => Promise<void>;
}

function usePane(): PaneState {
  const [endpoint, setEndpoint] = useState("local");
  const [cwd, setCwd] = useState("");
  const [raw, setRaw] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hideHidden, setHideHidden] = useState(false);
  const lastIdx = useRef(-1);

  const entries = hideHidden ? raw.filter((e) => !e.name.startsWith(".")) : raw;

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      setSelected(new Set());
      try {
        const res = endpoint === "local" ? await localList(path) : await sftpList(endpoint, path);
        setCwd(res.cwd);
        setRaw(res.entries);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  return {
    endpoint,
    hostId: endpoint === "local" ? null : endpoint,
    cwd,
    entries,
    loading,
    error,
    selected,
    hideHidden,
    toggleHidden: () => setHideHidden((h) => !h),
    setEndpoint,
    handleClick: (index, ctrl, shift) => {
      const name = entries[index]?.name;
      if (!name) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (shift && lastIdx.current >= 0) {
          const a = Math.min(lastIdx.current, index);
          const b = Math.max(lastIdx.current, index);
          next.clear();
          for (let i = a; i <= b; i++) next.add(entries[i].name);
        } else if (ctrl) {
          next.has(name) ? next.delete(name) : next.add(name);
        } else {
          next.clear();
          next.add(name);
        }
        return next;
      });
      lastIdx.current = index;
    },
    selectAll: () => setSelected(new Set(entries.map((e) => e.name))),
    clearSel: () => setSelected(new Set()),
    selectedEntries: () => entries.filter((e) => selected.has(e.name)),
    load,
  };
}

interface MenuState {
  x: number;
  y: number;
  side: Side;
  entry: SftpEntry | null;
}
interface DialogState {
  mode: "rename" | "mkdir";
  side: Side;
  oldName?: string;
  value: string;
}

function Pane({
  side,
  pane,
  hosts,
  dropActive,
  onInternalDrop,
  onPreview,
  onContext,
}: {
  side: Side;
  pane: PaneState;
  hosts: Host[];
  dropActive: boolean;
  onInternalDrop: (target: Side, from: Side, names: string[]) => void;
  onPreview: (pane: PaneState, name: string) => void;
  onContext: (side: Side, entry: SftpEntry | null, x: number, y: number) => void;
}) {
  const selCount = pane.selected.size;
  return (
    <div
      data-side={side}
      className={`flex min-h-0 min-w-0 flex-1 flex-col transition-colors ${
        dropActive ? "bg-accent-soft ring-1 ring-inset ring-accent" : ""
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYPE)) e.preventDefault();
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(DND_TYPE);
        if (!raw) return;
        e.preventDefault();
        try {
          const d = JSON.parse(raw) as { side: Side; names: string[] };
          if (d.side !== side && d.names.length) onInternalDrop(side, d.side, d.names);
        } catch {
          /* ignore */
        }
      }}
    >
      <div className="flex h-12 items-center gap-2 border-b border-line px-3">
        {pane.endpoint === "local" ? (
          <HardDrive size={16} className="shrink-0 text-content-muted" />
        ) : (
          <Server size={16} className="shrink-0 text-accent" />
        )}
        <select
          className="input h-8 py-1 text-xs"
          value={pane.endpoint}
          onChange={(e) => pane.setEndpoint(e.target.value)}
        >
          <option value="local">This PC (local)</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label} — {h.username}@{h.address}
            </option>
          ))}
        </select>
        <button className="btn-ghost ml-auto p-1.5" title="New folder" onClick={(e) => onContext(side, null, e.clientX, e.clientY)}>
          <FolderPlus size={14} />
        </button>
        <button className="btn-ghost p-1.5" title="Refresh" onClick={() => pane.load(pane.cwd)}>
          <RefreshCw size={14} className={pane.loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5">
        <button className="btn-ghost p-1" title="Up" onClick={() => pane.load(parentPath(pane.cwd))}>
          <ArrowUp size={14} />
        </button>
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-content-muted" dir="rtl">
          {pane.cwd || "…"}
        </code>
        {selCount > 0 && <span className="chip shrink-0">{selCount} selected</span>}
      </div>

      {pane.error && (
        <div className="m-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {pane.error}
        </div>
      )}

      <ul
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
        onClick={(e) => e.target === e.currentTarget && pane.clearSel()}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            onContext(side, null, e.clientX, e.clientY);
          }
        }}
      >
        {pane.entries.map((entry, index) => {
          const active = pane.selected.has(entry.name);
          const img = isImage(entry.name);
          return (
            <li
              key={entry.name}
              draggable
              onDragStart={(ev) => {
                const names = pane.selected.has(entry.name)
                  ? pane.selectedEntries().map((e) => e.name)
                  : [entry.name];
                ev.dataTransfer.setData(DND_TYPE, JSON.stringify({ side, names }));
                ev.dataTransfer.effectAllowed = "copy";
              }}
              onClick={(ev) => pane.handleClick(index, ev.ctrlKey || ev.metaKey, ev.shiftKey)}
              onDoubleClick={() => {
                if (entry.isDir) pane.load(joinPath(pane.cwd, entry.name));
                else if (img) onPreview(pane, entry.name);
              }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                if (!pane.selected.has(entry.name)) pane.handleClick(index, false, false);
                onContext(side, entry, ev.clientX, ev.clientY);
              }}
              className={`flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors duration-150 ${
                active ? "bg-accent-soft text-content ring-1 ring-inset ring-accent/40" : "hover:bg-surface-hover"
              }`}
            >
              {entry.isDir ? (
                <Folder size={16} className="shrink-0 text-info" />
              ) : img ? (
                <ImageIcon size={16} className="shrink-0 text-accent" />
              ) : (
                <FileIcon size={16} className="shrink-0 text-content-faint" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
              {!entry.isDir && (
                <span className="shrink-0 font-mono text-[10px] text-content-faint">
                  {humanSize(entry.size)}
                </span>
              )}
            </li>
          );
        })}
        {!pane.loading && pane.entries.length === 0 && !pane.error && (
          <li className="px-3 py-6 text-center text-xs text-content-faint">Empty</li>
        )}
      </ul>
    </div>
  );
}

interface PreviewState {
  name: string;
  url: string | null;
  loading: boolean;
  error: string | null;
}

interface Prog {
  item: string;
  itemIndex: number;
  itemCount: number;
  file: string;
  filePct: number;
  totalPct: number;
}

export function FileManager() {
  const hosts = useStore((s) => s.vault.hosts);
  const left = usePane();
  const right = usePane();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Side | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [progress, setProgress] = useState<Prog | null>(null);

  const leftRef = useRef(left);
  const rightRef = useRef(right);
  leftRef.current = left;
  rightRef.current = right;

  const paneOf = (s: Side) => (s === "left" ? left : right);
  const otherOf = (s: Side) => (s === "left" ? right : left);

  const transferMany = useCallback(async (from: PaneState, to: PaneState, names: string[]) => {
    const items = names
      .map((n) => from.entries.find((e) => e.name === n))
      .filter((e): e is SftpEntry => !!e);
    if (!items.length) return;
    setBusy(true);
    setMsg(null);
    setProgress(null);
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const tid = nanoid(8);
        const un = await listen<any>(`transfer://progress/${tid}`, (e) => {
          const p = e.payload;
          setProgress({
            item: item.name,
            itemIndex: i,
            itemCount: items.length,
            file: p.currentFile,
            filePct: p.fileTotal > 0 ? Math.round((p.fileDone / p.fileTotal) * 100) : 100,
            totalPct: p.totalTotal > 0 ? Math.round((p.totalDone / p.totalTotal) * 100) : 100,
          });
        });
        try {
          await transferStart(
            tid,
            from.hostId,
            joinPath(from.cwd, item.name),
            to.hostId,
            joinPath(to.cwd, item.name),
            item.isDir,
          );
        } finally {
          un();
        }
      }
      setMsg(`Copied ${items.length} item${items.length > 1 ? "s" : ""}`);
      await to.load(to.cwd);
    } catch (e) {
      setMsg("Transfer failed: " + String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const onInternalDrop = (target: Side, from: Side, names: string[]) =>
    transferMany(paneOf(from), paneOf(target), names);

  const openPreview = useCallback(async (pane: PaneState, name: string) => {
    setPreview({ name, url: null, loading: true, error: null });
    try {
      const b64 = await fileReadB64(pane.hostId, joinPath(pane.cwd, name));
      setPreview({ name, url: `data:${mimeOf(name)};base64,${b64}`, loading: false, error: null });
    } catch (e) {
      setPreview({ name, url: null, loading: false, error: String(e) });
    }
  }, []);

  const doDelete = async (pane: PaneState, entries: SftpEntry[]) => {
    if (!entries.length) return;
    const ok = await ask(
      `Delete ${entries.length} item${entries.length > 1 ? "s" : ""}? This cannot be undone.`,
      { title: "Confirm delete", kind: "warning" },
    );
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const e of entries) {
        setMsg(`Deleting ${e.name}`);
        await fileDelete(pane.hostId, joinPath(pane.cwd, e.name), e.isDir);
      }
      setMsg(`Deleted ${entries.length} item${entries.length > 1 ? "s" : ""}`);
      await pane.load(pane.cwd);
    } catch (e) {
      setMsg("Delete failed: " + String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitDialog = async () => {
    if (!dialog) return;
    const pane = paneOf(dialog.side);
    const name = dialog.value.trim();
    if (!name) return;
    setBusy(true);
    setMsg(null);
    try {
      if (dialog.mode === "mkdir") {
        await fileMkdir(pane.hostId, joinPath(pane.cwd, name));
      } else if (dialog.oldName) {
        await fileRename(
          pane.hostId,
          joinPath(pane.cwd, dialog.oldName),
          joinPath(pane.cwd, name),
        );
      }
      await pane.load(pane.cwd);
    } catch (e) {
      setMsg("Failed: " + String(e));
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  // OS file drop → upload to the pane under the cursor
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const sideAt = (pos: { x: number; y: number }): Side | null => {
      const dpr = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr) as HTMLElement | null;
      const s = el?.closest("[data-side]")?.getAttribute("data-side");
      return s === "left" || s === "right" ? s : null;
    };
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload as any;
        if (p.type === "over") setDropTarget(sideAt(p.position));
        else if (p.type === "leave") setDropTarget(null);
        else if (p.type === "drop") {
          const side = sideAt(p.position);
          setDropTarget(null);
          if (!side) return;
          const pane = side === "left" ? leftRef.current : rightRef.current;
          (async () => {
            setBusy(true);
            setProgress(null);
            const paths = p.paths as string[];
            try {
              for (let i = 0; i < paths.length; i++) {
                const path = paths[i];
                const tid = nanoid(8);
                const un = await listen<any>(`transfer://progress/${tid}`, (e) => {
                  const pr = e.payload;
                  setProgress({
                    item: baseName(path),
                    itemIndex: i,
                    itemCount: paths.length,
                    file: pr.currentFile,
                    filePct: pr.fileTotal > 0 ? Math.round((pr.fileDone / pr.fileTotal) * 100) : 100,
                    totalPct: pr.totalTotal > 0 ? Math.round((pr.totalDone / pr.totalTotal) * 100) : 100,
                  });
                });
                try {
                  await transferStart(tid, null, path, pane.hostId, joinPath(pane.cwd, baseName(path)), false);
                } finally {
                  un();
                }
              }
              setMsg(`Uploaded ${paths.length} item${paths.length > 1 ? "s" : ""}`);
            } catch (e) {
              setMsg("Upload failed: " + String(e));
            } finally {
              setBusy(false);
              setProgress(null);
              await pane.load(pane.cwd);
            }
          })();
        }
      });
    })();
    return () => unlisten?.();
  }, []);

  const leftSel = left.selectedEntries().map((e) => e.name);
  const rightSel = right.selectedEntries().map((e) => e.name);

  // ----- context menu items -----
  const menuItems = (m: MenuState) => {
    const pane = paneOf(m.side);
    const other = otherOf(m.side);
    const items: { label: string; icon: any; onClick: () => void; danger?: boolean; disabled?: boolean }[] = [];
    if (m.entry) {
      const e = m.entry;
      if (!e.isDir && isImage(e.name))
        items.push({ label: "Open preview", icon: Eye, onClick: () => openPreview(pane, e.name) });
      items.push({
        label: `Copy to ${other.endpoint === "local" ? "This PC" : "other host"}`,
        icon: Copy,
        onClick: () => {
          const names = pane.selected.has(e.name)
            ? pane.selectedEntries().map((x) => x.name)
            : [e.name];
          transferMany(pane, other, names);
        },
      });
      items.push({
        label: "Rename",
        icon: Pencil,
        onClick: () => setDialog({ mode: "rename", side: m.side, oldName: e.name, value: e.name }),
      });
      items.push({
        label: "Delete",
        icon: Trash2,
        danger: true,
        onClick: () => {
          const sel = pane.selectedEntries();
          doDelete(pane, sel.length && pane.selected.has(e.name) ? sel : [e]);
        },
      });
    }
    items.push({ label: "Refresh", icon: RefreshCw, onClick: () => pane.load(pane.cwd) });
    items.push({
      label: "New folder",
      icon: FolderPlus,
      onClick: () => setDialog({ mode: "mkdir", side: m.side, value: "New folder" }),
    });
    items.push({
      label: pane.hideHidden ? "Show hidden files" : "Hide hidden files",
      icon: pane.hideHidden ? Eye : EyeOff,
      onClick: pane.toggleHidden,
    });
    items.push({ label: "Select all", icon: CheckSquare, onClick: pane.selectAll });
    return items;
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg-inset">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-bg-raised px-4">
        <ArrowLeftRight size={16} className="text-accent" />
        <span className="text-sm font-semibold">File Transfer</span>
        {busy && !progress && <RefreshCw size={13} className="animate-spin text-content-faint" />}
        {msg && !progress && <span className="ml-2 truncate text-xs text-content-muted">{msg}</span>}
      </div>

      {progress && (
        <div className="shrink-0 border-b border-line bg-bg-raised px-4 py-2">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-content-muted">
            <span className="truncate font-mono">{progress.file || progress.item}</span>
            {progress.itemCount > 1 && (
              <span className="ml-auto shrink-0">
                item {progress.itemIndex + 1}/{progress.itemCount}
              </span>
            )}
            <span className="shrink-0 tabular-nums text-accent">{progress.totalPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-inset">
            <div
              className="h-full rounded-full bg-accent transition-all duration-150"
              style={{ width: `${progress.filePct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Pane side="left" pane={left} hosts={hosts} dropActive={dropTarget === "left"} onInternalDrop={onInternalDrop} onPreview={openPreview} onContext={(s, e, x, y) => setMenu({ side: s, entry: e, x, y })} />

        <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-3 border-x border-line bg-bg-raised">
          <button className="btn-primary h-9 w-9 p-0 disabled:opacity-30" title="Copy selected → right" disabled={!leftSel.length || busy} onClick={() => transferMany(left, right, leftSel)}>
            <ChevronRight size={18} />
          </button>
          <button className="btn-primary h-9 w-9 p-0 disabled:opacity-30" title="Copy selected ← left" disabled={!rightSel.length || busy} onClick={() => transferMany(right, left, rightSel)}>
            <ChevronLeft size={18} />
          </button>
        </div>

        <Pane side="right" pane={right} hosts={hosts} dropActive={dropTarget === "right"} onInternalDrop={onInternalDrop} onPreview={openPreview} onContext={(s, e, x, y) => setMenu({ side: s, entry: e, x, y })} />
      </div>

      <div className="flex h-7 shrink-0 items-center border-t border-line bg-bg-raised px-4 text-[11px] text-content-faint">
        Click to select · Ctrl/Shift-click for multiple · right-click for actions · drag to copy ·
        double-click an image to preview.
      </div>

      {/* context menu */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-xl border border-line-strong bg-bg-raised py-1 shadow-2xl animate-fade-in"
            style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 320) }}
          >
            {menuItems(menu).map((it, i) => (
              <button
                key={i}
                onClick={() => {
                  setMenu(null);
                  it.onClick();
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-hover ${
                  it.danger ? "text-danger hover:bg-danger/10" : "text-content"
                }`}
              >
                <it.icon size={15} className="shrink-0" />
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* rename / new folder dialog */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in" onClick={() => setDialog(null)}>
          <div className="card w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-content">
              {dialog.mode === "mkdir" ? "New folder" : `Rename "${dialog.oldName}"`}
            </h3>
            <input
              autoFocus
              className="input"
              value={dialog.value}
              onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitDialog();
                if (e.key === "Escape") setDialog(null);
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={submitDialog} disabled={!dialog.value.trim()}>
                {dialog.mode === "mkdir" ? "Create" : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* image preview */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8 animate-fade-in" onClick={() => setPreview(null)}>
          <div className="flex max-h-full max-w-4xl flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2">
              <ImageIcon size={15} className="text-accent" />
              <span className="truncate text-sm text-content">{preview.name}</span>
              <button className="btn-ghost ml-auto p-1.5" onClick={() => setPreview(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="flex min-h-0 items-center justify-center overflow-auto rounded-xl border border-line bg-bg-inset p-3">
              {preview.loading && (
                <div className="flex items-center gap-2 px-10 py-16 text-sm text-content-muted">
                  <RefreshCw size={16} className="animate-spin" /> Loading…
                </div>
              )}
              {preview.error && <div className="px-10 py-16 text-sm text-danger">{preview.error}</div>}
              {preview.url && <img src={preview.url} alt={preview.name} className="max-h-[70vh] max-w-full object-contain" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
