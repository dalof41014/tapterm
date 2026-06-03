import { useEffect, useRef, useState } from "react";
import { Bot, RotateCw, Terminal } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useStore, type Tab } from "../../store/useStore";
import { runSnippet } from "../../lib/session";
import { parseSlashCommands } from "../../lib/aiTools";

/**
 * Right-side panel showing commands for the AI tool running in `tab`.
 * On open it sends `/help` into the session once and parses the output to list
 * the tool's real commands; the curated list is shown as a fallback meanwhile.
 * Clicking a command sends it straight into that terminal.
 */
export function AiCommandPanel({ tab }: { tab: Tab }) {
  const aiTools = useStore((s) => s.aiTools);
  const fetched = useStore((s) => s.aiCommands[tab.id]);
  const setAiCommands = useStore((s) => s.setAiCommands);
  const tool = aiTools.find((t) => t.id === tab.aiTool);
  const [loading, setLoading] = useState(false);
  const autoTried = useRef(false);

  const run = (command: string) => {
    runSnippet(tab.id, command, tab.kind).catch(() => {});
  };

  // Send `/help`, capture the session output for a moment, then parse it.
  const fetchCommands = async () => {
    if (loading) return;
    setLoading(true);
    const acc: string[] = [];
    let un: (() => void) | undefined;
    try {
      un = await listen<string>(`ssh://data/${tab.id}`, (e) => acc.push(e.payload));
      await runSnippet(tab.id, "/help", tab.kind);
      await new Promise((r) => setTimeout(r, 1400));
    } catch {
      /* ignore */
    } finally {
      un?.();
    }
    // store whatever we parsed (even empty) so we don't auto-retry on every open
    setAiCommands(tab.id, parseSlashCommands(acc.join("")));
    setLoading(false);
  };

  // Auto-fetch once, after a short delay so the tool can finish booting.
  useEffect(() => {
    if (autoTried.current || fetched) return;
    autoTried.current = true;
    const t = setTimeout(() => {
      fetchCommands();
    }, 2800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  const live = !!(fetched && fetched.length);
  const commands = live ? fetched! : tool?.commands ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-line px-4">
        <Bot size={16} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {tool?.name ?? "AI commands"}
        </span>
        <button
          className="btn-ghost p-1"
          title="Reload commands (/help)"
          onClick={fetchCommands}
          disabled={loading}
        >
          <RotateCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {commands.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-content-faint">
            {loading ? "Loading commands…" : "No commands yet. Type directly in the terminal."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {commands.map((c) => (
              <li key={c.command}>
                <button
                  onClick={() => run(c.command)}
                  title={`Send "${c.command}" to the terminal`}
                  className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-surface-hover"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-content-faint transition-colors group-hover:text-accent">
                    <Terminal size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-content">{c.label}</span>
                    <span className="block truncate font-mono text-[11px] text-content-faint">
                      {c.command}
                    </span>
                    {c.hint && (
                      <span className="block truncate text-[11px] text-content-faint/80">{c.hint}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-content-faint">
        {live
          ? `Loaded from ${tool?.name ?? "the tool"}'s /help — click ↻ to re-scan.`
          : loading
            ? "Reading the tool's /help…"
            : `Common ${tool?.name ?? ""} commands — click ↻ to load the full list from /help.`}
      </div>
    </div>
  );
}
