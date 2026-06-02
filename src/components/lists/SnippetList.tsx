import { useState } from "react";
import { Pencil, Play, Plus, SquareCode, Trash2 } from "lucide-react";
import { useStore } from "../../store/useStore";
import type { Snippet } from "../../lib/types";
import { SnippetModal } from "../modals/SnippetModal";
import { runSnippet } from "../../lib/session";

export function SnippetList() {
  const snippets = useStore((s) => s.vault.snippets);
  const search = useStore((s) => s.search).toLowerCase();
  const deleteSnippet = useStore((s) => s.deleteSnippet);
  const activeTabId = useStore((s) => s.activeTabId);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = snippets.filter(
    (s) => s.label.toLowerCase().includes(search) || s.command.toLowerCase().includes(search),
  );

  return (
    <div>
      <button className="btn-surface mb-2 w-full justify-center py-1.5 text-xs" onClick={() => setCreating(true)}>
        <Plus size={14} /> New Snippet
      </button>

      {filtered.length === 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 px-4 text-center text-content-faint">
          <SquareCode size={28} className="opacity-40" />
          <p className="text-xs">{snippets.length === 0 ? "No snippets yet." : "No matches."}</p>
        </div>
      )}

      <ul className="space-y-0.5">
        {filtered.map((s) => (
          <li
            key={s.id}
            className="group rounded-lg px-2.5 py-2 transition-colors duration-200 hover:bg-surface-hover"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-content">{s.label}</span>
              <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  className="btn-ghost p-1 hover:text-accent disabled:opacity-30"
                  title="Run in active terminal"
                  disabled={!activeTabId}
                  onClick={() => activeTabId && runSnippet(activeTabId, s.command, activeTab?.kind ?? "ssh")}
                >
                  <Play size={13} />
                </button>
                <button className="btn-ghost p-1" title="Edit" onClick={() => setEditing(s)}>
                  <Pencil size={13} />
                </button>
                <button
                  className="btn-ghost p-1 hover:text-danger"
                  title="Delete"
                  onClick={() => deleteSnippet(s.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <code className="mt-1 block truncate rounded bg-bg-inset px-2 py-1 font-mono text-[11px] text-accent">
              {s.command}
            </code>
          </li>
        ))}
      </ul>

      {creating && <SnippetModal onClose={() => setCreating(false)} />}
      {editing && <SnippetModal snippet={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
