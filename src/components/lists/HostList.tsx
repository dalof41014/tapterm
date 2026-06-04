import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Pencil,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { useStore } from "../../store/useStore";
import type { Group, Host } from "../../lib/types";
import { HostModal } from "../modals/HostModal";
import { GroupModal } from "../modals/GroupModal";

const HOST_DND = "application/x-host";

export function HostList() {
  const hosts = useStore((s) => s.vault.hosts);
  const groups = useStore((s) => s.vault.groups);
  const search = useStore((s) => s.search).toLowerCase();
  const collapsed = useStore((s) => s.collapsedGroups);
  const toggleGroup = useStore((s) => s.toggleGroup);
  const openHost = useStore((s) => s.openHost);
  const deleteHost = useStore((s) => s.deleteHost);
  const duplicateHost = useStore((s) => s.duplicateHost);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const moveHostsToGroup = useStore((s) => s.moveHostsToGroup);
  const setMainView = useStore((s) => s.setMainView);

  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [creatingHost, setCreatingHost] = useState<{ groupId: string | null } | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  // drag-to-group state. dropGid: the group being hovered (null = ungrouped zone)
  const [dragging, setDragging] = useState(false);
  const [dropGid, setDropGid] = useState<string | null | undefined>(undefined);

  const startDrag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(HOST_DND, JSON.stringify([id]));
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };
  const allowDrop = (e: React.DragEvent, gid: string | null) => {
    if (!e.dataTransfer.types.includes(HOST_DND)) return;
    e.preventDefault();
    setDropGid(gid);
  };
  const dropOnGroup = (e: React.DragEvent, gid: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    setDropGid(undefined);
    const raw = e.dataTransfer.getData(HOST_DND);
    if (!raw) return;
    moveHostsToGroup(JSON.parse(raw) as string[], gid);
  };
  const endDrag = () => {
    setDragging(false);
    setDropGid(undefined);
  };

  const matchHost = (h: Host) =>
    h.label.toLowerCase().includes(search) ||
    h.address.toLowerCase().includes(search) ||
    h.username.toLowerCase().includes(search) ||
    h.tags.some((t) => t.toLowerCase().includes(search));

  const HostRow = ({ h, depth }: { h: Host; depth: number }) => (
    <div
      draggable
      onDragStart={(e) => startDrag(e, h.id)}
      onDragEnd={endDrag}
      onDoubleClick={() => openHost(h.id)}
      style={{ paddingLeft: 8 + depth * 14 }}
      className="group flex cursor-pointer items-center gap-2.5 rounded-lg py-2 pr-2 transition-colors duration-200 hover:bg-surface-hover"
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold uppercase"
        style={{ background: (h.color ?? "#22C55E") + "22", color: h.color ?? "#22C55E" }}
      >
        {h.label.slice(0, 2)}
      </span>
      <button className="min-w-0 flex-1 text-left" onClick={() => openHost(h.id)} title="Connect">
        <div className="truncate text-sm font-medium text-content" title={h.label}>
          {h.label}
        </div>
        <div
          className="truncate font-mono text-[11px] text-content-faint"
          title={`${h.username}@${h.address}:${h.port}`}
        >
          {h.username}@{h.address}:{h.port}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button className="btn-ghost p-1" title="Edit" onClick={() => setEditingHost(h)}>
          <Pencil size={13} />
        </button>
        <button className="btn-ghost p-1" title="Duplicate" onClick={() => duplicateHost(h.id)}>
          <Copy size={13} />
        </button>
        <button className="btn-ghost p-1 hover:text-danger" title="Delete" onClick={() => deleteHost(h.id)}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );

  const GroupNode = ({ group, depth }: { group: Group; depth: number }) => {
    const isOpen = !collapsed.has(group.id);
    const childGroups = groups.filter((g) => g.parentId === group.id);
    const childHosts = hosts.filter((h) => h.groupId === group.id);
    const count = childHosts.length;
    return (
      <li>
        <div
          style={{ paddingLeft: 4 + depth * 14 }}
          className={`group flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 transition-colors duration-200 ${
            dropGid === group.id
              ? "bg-accent-soft ring-1 ring-inset ring-accent"
              : "hover:bg-surface-hover"
          }`}
          onClick={() => toggleGroup(group.id)}
          onDragOver={(e) => allowDrop(e, group.id)}
          onDragLeave={() => setDropGid((g) => (g === group.id ? undefined : g))}
          onDrop={(e) => dropOnGroup(e, group.id)}
        >
          {isOpen ? (
            <ChevronDown size={14} className="shrink-0 text-content-faint" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-content-faint" />
          )}
          {isOpen ? (
            <FolderOpen size={15} className="shrink-0 text-info" />
          ) : (
            <Folder size={15} className="shrink-0 text-info" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-content" title={group.name}>{group.name}</span>
          {count > 0 && <span className="chip shrink-0">{count}</span>}
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              className="btn-ghost p-1"
              title="Add host here"
              onClick={(e) => {
                e.stopPropagation();
                setCreatingHost({ groupId: group.id });
              }}
            >
              <Plus size={13} />
            </button>
            <button
              className="btn-ghost p-1"
              title="Edit group"
              onClick={(e) => {
                e.stopPropagation();
                setEditingGroup(group);
              }}
            >
              <Pencil size={13} />
            </button>
            <button
              className="btn-ghost p-1 hover:text-danger"
              title="Delete group (hosts kept)"
              onClick={(e) => {
                e.stopPropagation();
                deleteGroup(group.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {isOpen && (
          <ul>
            {childGroups.map((g) => (
              <GroupNode key={g.id} group={g} depth={depth + 1} />
            ))}
            {childHosts.map((h) => (
              <HostRow key={h.id} h={h} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  };

  const rootGroups = groups.filter((g) => !g.parentId);
  const ungrouped = hosts.filter((h) => !h.groupId);
  const flat = hosts.filter(matchHost);

  return (
    <div onDragEnd={endDrag}>
      <button
        className="btn-ghost mb-1.5 w-full justify-center py-1.5 text-xs"
        onClick={() => setMainView("hosts")}
      >
        <LayoutGrid size={14} /> Manage all hosts
      </button>
      <div className="mb-2 flex gap-1.5">
        <button className="btn-surface flex-1 justify-center py-1.5 text-xs" onClick={() => setCreatingHost({ groupId: null })}>
          <Plus size={14} /> Host
        </button>
        <button className="btn-surface flex-1 justify-center py-1.5 text-xs" onClick={() => setCreatingGroup(true)}>
          <FolderPlus size={14} /> Group
        </button>
      </div>

      {hosts.length === 0 && groups.length === 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 px-4 text-center text-content-faint">
          <Server size={28} className="opacity-40" />
          <p className="text-xs">No hosts yet. Add your first server.</p>
        </div>
      )}

      {search ? (
        <ul className="space-y-0.5">
          {flat.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-content-faint">No matches.</li>
          ) : (
            flat.map((h) => <HostRow key={h.id} h={h} depth={0} />)
          )}
        </ul>
      ) : (
        <>
          <ul className="space-y-0.5">
            {rootGroups.map((g) => (
              <GroupNode key={g.id} group={g} depth={0} />
            ))}
            {ungrouped.map((h) => (
              <HostRow key={h.id} h={h} depth={0} />
            ))}
          </ul>
          {dragging && (
            <div
              onDragOver={(e) => allowDrop(e, null)}
              onDragLeave={() => setDropGid((g) => (g === null ? undefined : g))}
              onDrop={(e) => dropOnGroup(e, null)}
              className={`mt-1.5 rounded-lg border border-dashed py-3 text-center text-[11px] transition-colors ${
                dropGid === null
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-strong text-content-faint"
              }`}
            >
              Drop here to remove from group
            </div>
          )}
        </>
      )}

      {creatingHost && (
        <HostModal defaultGroupId={creatingHost.groupId} onClose={() => setCreatingHost(null)} />
      )}
      {editingHost && <HostModal host={editingHost} onClose={() => setEditingHost(null)} />}
      {creatingGroup && <GroupModal onClose={() => setCreatingGroup(false)} />}
      {editingGroup && <GroupModal group={editingGroup} onClose={() => setEditingGroup(null)} />}
    </div>
  );
}
