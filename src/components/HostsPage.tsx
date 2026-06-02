import { useState } from "react";
import {
  Copy,
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

function HostCard({
  h,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  h: Host;
  onConnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const color = h.color ?? "#6366F1";
  return (
    <div
      onDoubleClick={onConnect}
      className="group flex flex-col rounded-xl border border-line bg-bg-raised p-3 transition-colors duration-200 hover:border-line-strong"
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
        <button className="btn-primary flex-1 px-2 py-1 text-xs" onClick={onConnect}>
          <Zap size={13} /> Connect
        </button>
        <button className="btn-ghost p-1.5" title="Edit" onClick={onEdit}>
          <Pencil size={14} />
        </button>
        <button className="btn-ghost p-1.5" title="Duplicate" onClick={onDuplicate}>
          <Copy size={14} />
        </button>
        <button className="btn-ghost p-1.5 hover:text-danger" title="Delete" onClick={onDelete}>
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

  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [creatingHost, setCreatingHost] = useState<{ groupId: string | null } | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const allTags = Array.from(new Set(hosts.flatMap((h) => h.tags))).sort();
  const q = search.toLowerCase();

  const matches = (h: Host) =>
    (!activeTag || h.tags.includes(activeTag)) &&
    (h.label.toLowerCase().includes(q) ||
      h.address.toLowerCase().includes(q) ||
      h.username.toLowerCase().includes(q) ||
      h.tags.some((t) => t.toLowerCase().includes(q)));

  const connect = (id: string) => {
    openHost(id);
    setMainView("terminals");
  };

  const filtered = hosts.filter(matches);
  // sections: each group with matching hosts, then ungrouped
  const sections: { key: string; name: string; items: Host[] }[] = [];
  for (const g of groups) {
    const items = filtered.filter((h) => h.groupId === g.id);
    if (items.length) sections.push({ key: g.id, name: g.name, items });
  }
  const ungrouped = filtered.filter((h) => !h.groupId || !groups.some((g) => g.id === h.groupId));
  if (ungrouped.length) sections.push({ key: "__ungrouped", name: "Ungrouped", items: ungrouped });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg-inset">
      {/* header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg-raised px-4">
        <Server size={16} className="text-accent" />
        <span className="text-sm font-semibold">Hosts</span>
        <span className="text-xs text-content-faint">{hosts.length}</span>
        <div className="relative ml-2 w-64">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
          <input
            className="input py-1.5 pl-8 text-xs"
            placeholder="Search hosts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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

      {/* tag filters */}
      {allTags.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-bg-raised px-4 py-2">
          <Tag size={13} className="text-content-faint" />
          <button
            onClick={() => setActiveTag(null)}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
              !activeTag ? "bg-accent text-bg" : "bg-surface text-content-muted hover:bg-surface-hover"
            }`}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                activeTag === t ? "bg-accent text-bg" : "bg-surface text-content-muted hover:bg-surface-hover"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
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
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-content-muted">{sec.name}</h3>
                <span className="text-[11px] text-content-faint">{sec.items.length}</span>
                {sec.key !== "__ungrouped" && (
                  <button
                    className="btn-ghost p-1 opacity-60 hover:opacity-100"
                    title="Add host to group"
                    onClick={() => setCreatingHost({ groupId: sec.key })}
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {sec.items.map((h) => (
                  <HostCard
                    key={h.id}
                    h={h}
                    onConnect={() => connect(h.id)}
                    onEdit={() => setEditingHost(h)}
                    onDuplicate={() => duplicateHost(h.id)}
                    onDelete={() => deleteHost(h.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {creatingHost && <HostModal defaultGroupId={creatingHost.groupId} onClose={() => setCreatingHost(null)} />}
      {editingHost && <HostModal host={editingHost} onClose={() => setEditingHost(null)} />}
      {creatingGroup && <GroupModal onClose={() => setCreatingGroup(false)} />}
      {editingGroup && <GroupModal group={editingGroup} onClose={() => setEditingGroup(null)} />}
    </div>
  );
}
