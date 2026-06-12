import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Plus, Search, Server, TerminalSquare } from "lucide-react";
import { useStore } from "../store/useStore";

type Item =
  | { kind: "session"; id: string; title: string; sub: string; dot: string; remote: boolean }
  | { kind: "host"; id: string; title: string; sub: string; color: string };

const statusDot = (s: string) =>
  s === "connected"
    ? "bg-accent"
    : s === "connecting"
      ? "bg-warn"
      : s === "error"
        ? "bg-danger"
        : "bg-content-faint";

/** Ctrl/Cmd+P command palette: fuzzy-jump between open sessions, and open hosts. */
export function QuickSwitch() {
  const open = useStore((s) => s.quickOpen);
  const setOpen = useStore((s) => s.setQuickOpen);
  const tabs = useStore((s) => s.tabs);
  const hosts = useStore((s) => s.vault.hosts);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const openHost = useStore((s) => s.openHost);
  const setMainView = useStore((s) => s.setMainView);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    for (const t of tabs) {
      const h = hosts.find((x) => x.id === t.hostId);
      const sub = h
        ? `${h.username}@${h.address}`
        : t.kind === "local"
          ? "Local shell"
          : t.kind === "telnet"
            ? "Telnet"
            : "";
      if (
        !q ||
        t.title.toLowerCase().includes(q) ||
        sub.toLowerCase().includes(q) ||
        (h && h.label.toLowerCase().includes(q))
      ) {
        out.push({ kind: "session", id: t.id, title: t.title, sub, dot: statusDot(t.status), remote: t.kind !== "local" });
      }
    }
    if (q) {
      for (const h of hosts) {
        if (
          h.label.toLowerCase().includes(q) ||
          h.address.toLowerCase().includes(q) ||
          h.username.toLowerCase().includes(q) ||
          h.tags.some((t) => t.toLowerCase().includes(q))
        ) {
          out.push({
            kind: "host",
            id: h.id,
            title: h.label,
            sub: `${h.username}@${h.address}`,
            color: h.color ?? "#22C55E",
          });
        }
      }
    }
    return out;
  }, [query, tabs, hosts]);

  if (!open) return null;

  const clampedActive = Math.min(active, Math.max(0, items.length - 1));

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "session") setActiveTab(item.id);
    else openHost(item.id);
    setMainView("terminals");
    setOpen(false);
  };

  const firstHostIdx = items.findIndex((i) => i.kind === "host");

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line-strong bg-bg-raised shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <Search size={16} className="shrink-0 text-content-faint" />
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-faint"
            placeholder="Jump to a session or host…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (items.length ? (a + 1) % items.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(items[clampedActive]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <kbd className="shrink-0 rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] text-content-faint">
            Esc
          </kbd>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-content-faint">No matches.</li>
          ) : (
            items.map((item, i) => (
              <li key={`${item.kind}-${item.id}`}>
                {i === firstHostIdx && (
                  <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-content-faint">
                    Open host
                  </div>
                )}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    i === clampedActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                  }`}
                >
                  {item.kind === "session" ? (
                    <>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
                      {item.remote ? (
                        <Server size={15} className="shrink-0 text-content-faint" />
                      ) : (
                        <TerminalSquare size={15} className="shrink-0 text-content-faint" />
                      )}
                    </>
                  ) : (
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold uppercase"
                      style={{ background: item.color + "22", color: item.color }}
                    >
                      {item.title.slice(0, 2)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-content">{item.title}</span>
                    {item.sub && (
                      <span className="block truncate font-mono text-[11px] text-content-faint">{item.sub}</span>
                    )}
                  </span>
                  {item.kind === "host" ? (
                    <Plus size={13} className="shrink-0 text-content-faint" />
                  ) : (
                    i === clampedActive && <CornerDownLeft size={13} className="shrink-0 text-content-faint" />
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
