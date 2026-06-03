import { useRef, useState } from "react";
import {
  Copy,
  FolderInput,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Server,
  Tag,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useStore } from "../store/useStore";
import type { Group, Host } from "../lib/types";
import { HostModal } from "./modals/HostModal";
import { GroupModal } from "./modals/GroupModal";

const HOST_DND = "application/x-host";

function HostCard({
  h,
  selected,
  onClick,
  onDragStart,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  h: Host;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onConnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const color = h.color ?? "#6366F1";
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onConnect}
      className={`group flex cursor-pointer select-none flex-col rounded-xl border p-3 transition-colors duration-200 ${
        selected
          ? "border-accent bg-accent-soft ring-1 ring-inset ring-accent/40"
          : "border-line bg-bg-raised hover:border-line-strong"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold uppercase"
          style={{ background: color + "22", color }}
        >
          {h.label.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-content">{h.label}</div>
          <div className="truncate font-mono text-[11px] text-content-faint">
            {h.username}@{h.address}:{h.port}
          </div>
        </div>
      </div>

      {h.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {h.tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-1 pt-1">
        <button
          className="btn-primary flex-1 px-2 py-1 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onConnect();
          }}
        >
          <Zap size={13} /> Connect
        </button>
        <button className="btn-ghost p-1.5" title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil size={14} />
        </button>
        <button className="btn-ghost p-1.5" title="Duplicate" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
          <Copy size={14} />
        </button>
        <button className="btn-ghost p-1.5 hover:text-danger" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function HostsPage() {
  const hosts = useStore((s) => s.vault.hosts);
  const groups = useStore((s) => s.vault.groups);
  const openHost = useStore((s) => s.openHost);
  const setMainView = useStore((s) => s.setMainView);
  const duplicateHost = useStore((s) => s.duplicateHost);
  const deleteHost = useStore((s) => s.deleteHost);
  const deleteHosts = useStore((s) => s.deleteHosts);
  const moveHostsToGroup = useStore((s) => s.moveHostsToGroup);
  const search = useStore((s) => s.hostSearch);
  const setSearch = useStore((s) => s.setHostSearch);
  const activeTag = useStore((s) => s.hostTag);
  const setActiveTag = useStore((s) => s.setHostTag);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [dropGroup, setDropGroup] = useState<string | null | undefined>(undefined);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [creatingHost, setCreatingHost] = useState<{ groupId: string | null } | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const lastIdx = useRef(-1);

  const allTags = Array.from(new Set(hosts.flatMap((h) => h.tags))).sort();
  const q = search.toLowerCase();
  const matches = (h: Host) =>
    (!activeTag || h.tags.includes(activeTag)) &&
    (h.label.toLowerCase().includes(q) ||
      h.address.toLowerCase().includes(q) ||
      h.username.toLowerCase().includes(q) ||
      h.tags.some((t) => t.toLowerCase().includes(q)));
  const filtered = hosts.filter(matches);

  // sections + a flat ordered list for shift-select
  const sections: { key: string; gid: string | null; name: string; items: Host[] }[] = [];
  for (const g of groups) {
    const items = filtered.filter((h) => h.groupId === g.id);
    if (items.length || dragging) sections.push({ key: g.id, gid: g.id, name: g.name, items });
  }
  const ungrouped = filtered.filter((h) => !h.groupId || !groups.some((g) => g.id === h.groupId));
  if (ungrouped.length || dragging)
    sections.push({ key: "__ungrouped", gid: null, name: "Ungrouped", items: ungrouped });
  const ordered = sections.flatMap((s) => s.items);

  const handleClick = (e: React.MouseEvent, id: string) => {
    const index = ordered.findIndex((h) => h.id === id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastIdx.current >= 0) {
        const a = Math.min(lastIdx.current, index);
        const b = Math.max(lastIdx.current, index);
        next.clear();
        for (let i = a; i <= b; i++) next.add(ordered[i].id);
      } else if (e.ctrlKey || e.metaKey) {
        next.has(id) ? next.delete(id) : next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
    lastIdx.current = index;
  };

  const startDrag = (e: React.DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    if (!selected.has(id)) setSelected(new Set([id]));
    e.dataTransfer.setData(HOST_DND, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };

  const dropOnGroup = (e: React.DragEvent, gid: string | null) => {
    e.preventDefault();
    setDropGroup(undefined);
    setDragging(false);
    const raw = e.dataTransfer.getData(HOST_DND);
    if (!raw) return;
    const ids = JSON.parse(raw) as string[];
    moveHostsToGroup(ids, gid);
    setSelected(new Set());
  };

  const connect = (id: string) => {
    openHost(id);
    setMainView("terminals");
  };

  const selArr = [...selected];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg-inset" onDragEnd={() => { setDragging(false); setDropGroup(undefined); }}>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg-raised px-4">
        <Server size={16} className="text-accent" />
        <span className="text-sm font-semibold">Hosts</span>
        <span className="text-xs text-content-faint">{hosts.length}</span>
        <div className="relative ml-2 w-64">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
          <input className="input py-1.5 pl-8 text-xs" placeholder="Search hosts…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-surface px-3 py-1.5 text-xs" onClick={() => setCreatingGroup(true)}>
            <FolderPlus size={14} /> Group
          </button>
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setCreatingHost({ groupId: null })}>
            <Plus size={14} /> New Host
          </button>
          <button className="btn-ghost p-1.5" title="Close" onClick={() => setMainView("terminals")}>
            <X size={16} />
          </button>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-bg-raised px-4 py-2">
          <Tag size={13} className="text-content-faint" />
          <button onClick={() => setActiveTag(null)} className={`rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer ${!activeTag ? "bg-accent text-bg" : "bg-surface text-content-muted hover:bg-surface-hover"}`}>All</button>
          {allTags.map((t) => (
            <button key={t} onClick={() => setActiveTag(activeTag === t ? null : t)} className={`rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer ${activeTag === t ? "bg-accent text-bg" : "bg-surface text-content-muted hover:bg-surface-hover"}`}>{t}</button>
          ))}
        </div>
      )}

      {/* batch toolbar */}
      {selected.size > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-accent-soft px-4 py-2 text-xs">
          <span className="font-medium text-content">{selected.size} selected</span>
          <FolderInput size={14} className="ml-2 text-content-muted" />
          <select
            className="input h-7 w-44 py-0 text-xs"
            value=""
            onChange={(e) => {
              moveHostsToGroup(selArr, e.target.value || null);
              setSelected(new Set());
            }}
          >
            <option value="" disabled>
              Move to group…
            </option>
            <option value="">— Ungrouped —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button className="btn-ghost px-2 py-1" onClick={() => { selArr.forEach((id) => duplicateHost(id)); setSelected(new Set()); }}>
            <Copy size={13} /> Duplicate
          </button>
          <button className="btn-ghost px-2 py-1 hover:text-danger" onClick={() => { deleteHosts(selArr); setSelected(new Set()); }}>
            <Trash2 size={13} /> Delete
          </button>
          <button className="btn-ghost ml-auto px-2 py-1" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4" onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}>
        {filtered.length === 0 && !dragging ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-content-faint">
            <Server size={32} className="opacity-40" />
            <p className="text-sm">{hosts.length === 0 ? "No hosts yet." : "No matches."}</p>
            <button className="btn-surface mt-1 px-3 py-1.5 text-xs" onClick={() => setCreatingHost({ groupId: null })}>
              <Plus size={14} /> New Host
            </button>
          </div>
        ) : (
          sections.map((sec) => (
            <div key={sec.key} className="mb-6">
              <div
                onDragOver={(e) => { if (e.dataTransfer.types.includes(HOST_DND)) { e.preventDefault(); setDropGroup(sec.gid); } }}
                onDragLeave={() => setDropGroup(undefined)}
                onDrop={(e) => dropOnGroup(e, sec.gid)}
                className={`mb-2 flex items-center gap-2 rounded-lg px-2 py-1 transition-colors ${
                  dropGroup === sec.gid ? "bg-accent-soft ring-1 ring-inset ring-accent" : ""
                }`}
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-content-muted">{sec.name}</h3>
                <span className="text-[11px] text-content-faint">{sec.items.length}</span>
                {dragging && (
                  <span className="text-[10px] text-accent">drop here to move</span>
                )}
                {sec.gid && !dragging && (
                  <button className="btn-ghost p-1 opacity-60 hover:opacity-100" title="Add host to group" onClick={() => setCreatingHost({ groupId: sec.gid })}>
                    <Plus size={13} />
                  </button>
                )}
              </div>
              {sec.items.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                  {sec.items.map((h) => (
                    <HostCard
                      key={h.id}
                      h={h}
                      selected={selected.has(h.id)}
                      onClick={(e) => handleClick(e, h.id)}
                      onDragStart={(e) => startDrag(e, h.id)}
                      onConnect={() => connect(h.id)}
                      onEdit={() => setEditingHost(h)}
                      onDuplicate={() => duplicateHost(h.id)}
                      onDelete={() => deleteHost(h.id)}
                    />
                  ))}
                </div>
              ) : (
                dragging && (
                  <div
                    onDragOver={(e) => { if (e.dataTransfer.types.includes(HOST_DND)) { e.preventDefault(); setDropGroup(sec.gid); } }}
                    onDrop={(e) => dropOnGroup(e, sec.gid)}
                    className={`rounded-lg border border-dashed py-4 text-center text-[11px] ${
                      dropGroup === sec.gid ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-content-faint"
                    }`}
                  >
                    drop hosts here
                  </div>
                )
              )}
            </div>
          ))
        )}
      </div>

      {creatingHost && <HostModal defaultGroupId={creatingHost.groupId} onClose={() => setCreatingHost(null)} />}
      {editingHost && <HostModal host={editingHost} onClose={() => setEditingHost(null)} />}
      {creatingGroup && <GroupModal onClose={() => setCreatingGroup(false)} />}
    </div>
  );
}
