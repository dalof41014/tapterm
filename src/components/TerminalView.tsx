import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { AlertTriangle, ArrowDown, ArrowUp, Pencil, RotateCw, X } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  localClose,
  localOpen,
  localResize,
  localSend,
  sshClose,
  sshOpenShell,
  sshResize,
  sshSend,
} from "../lib/api";
import { useStore, type Tab } from "../store/useStore";
import { themeById } from "../lib/themes";
import { fontFamilyCss } from "../lib/fonts";
import { HostModal } from "./modals/HostModal";

const SEARCH_OPTS = {
  decorations: {
    matchBackground: "#FBBF24",
    matchOverviewRuler: "#FBBF24",
    activeMatchBackground: "#6366F1",
    activeMatchColorOverviewRuler: "#6366F1",
  },
};

export function TerminalView({ tab }: { tab: Tab }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const setTabStatus = useStore((s) => s.setTabStatus);
  const host = useStore((s) => s.vault.hosts.find((h) => h.id === tab.hostId));
  const closeTab = useStore((s) => s.closeTab);
  const openHost = useStore((s) => s.openHost);
  const themeId = useStore((s) => s.terminalThemeId);
  const fontId = useStore((s) => s.terminalFontId);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: fontFamilyCss(host?.font || fontId),
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      theme: themeById(themeId),
      allowProposedApi: true,
      scrollback: 10000,
    });
    const fit = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();
    termRef.current = term;
    searchRef.current = searchAddon;
    fitRef.current = fit;

    // Keyboard shortcuts: copy/paste and in-terminal search.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Ctrl/Cmd+Shift+C → copy selection
      if (mod && e.shiftKey && key === "c") {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          return false;
        }
        return true;
      }
      // Ctrl/Cmd+Shift+V → paste into the session
      if (mod && e.shiftKey && key === "v") {
        navigator.clipboard
          .readText()
          .then((t) => {
            if (t) (tab.kind === "local" ? localSend : sshSend)(tab.id, t).catch(() => {});
          })
          .catch(() => {});
        return false;
      }
      // Ctrl/Cmd+F → search
      if (mod && !e.shiftKey && key === "f") {
        setSearchOpen(true);
        return false;
      }
      return true;
    });

    let unlistenData: UnlistenFn | undefined;
    let unlistenClosed: UnlistenFn | undefined;
    let disposed = false;
    let firstData = true;

    (async () => {
      unlistenData = await listen<string>(`ssh://data/${tab.id}`, (e) => {
        if (firstData) {
          firstData = false;
          setTabStatus(tab.id, "connected");
        }
        term.write(e.payload);
      });
      unlistenClosed = await listen(`ssh://closed/${tab.id}`, () => {
        setTabStatus(tab.id, "closed");
        term.write("\r\n\x1b[2m[ session closed ]\x1b[0m\r\n");
      });

      try {
        await (tab.kind === "local"
          ? localOpen(tab.id, term.cols, term.rows)
          : sshOpenShell(tab.id, tab.hostId, term.cols, term.rows));
      } catch (err) {
        if (!disposed) {
          setTabStatus(tab.id, "error", String(err));
          term.write(`\r\n\x1b[31m✖ ${String(err)}\x1b[0m\r\n`);
        }
      }
    })();

    const onData = term.onData((data) => {
      (tab.kind === "local" ? localSend : sshSend)(tab.id, data).catch(() => {});
    });

    const doFit = () => {
      try {
        fit.fit();
        (tab.kind === "local" ? localResize : sshResize)(tab.id, term.cols, term.rows).catch(
          () => {},
        );
      } catch {
        /* noop */
      }
    };
    const ro = new ResizeObserver(doFit);
    ro.observe(el);

    term.focus();

    return () => {
      disposed = true;
      ro.disconnect();
      onData.dispose();
      unlistenData?.();
      unlistenClosed?.();
      (tab.kind === "local" ? localClose : sshClose)(tab.id).catch(() => {});
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // apply terminal theme changes live
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themeById(themeId);
  }, [themeId]);

  // apply font changes live (re-fit since cell size changes)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamilyCss(host?.font || fontId);
    try {
      fitRef.current?.fit();
      (tab.kind === "local" ? localResize : sshResize)(tab.id, term.cols, term.rows).catch(() => {});
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontId, host?.font]);

  const findNext = (q = query) => q && searchRef.current?.findNext(q, SEARCH_OPTS);
  const findPrev = (q = query) => q && searchRef.current?.findPrevious(q, SEARCH_OPTS);

  const closeSearch = () => {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  return (
    <div className="relative h-full w-full bg-[#0B1220]">
      {tab.status === "error" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-inset/80 p-6 backdrop-blur-sm">
          <div className="card w-full max-w-md p-5 shadow-2xl animate-fade-in">
            <div className="mb-3 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
                <AlertTriangle size={20} />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-content">Connection failed</h3>
                {host && (
                  <p className="truncate font-mono text-[11px] text-content-faint">
                    {host.username}@{host.address}:{host.port}
                  </p>
                )}
              </div>
            </div>

            <div className="mb-3 max-h-32 overflow-y-auto rounded-lg bg-bg-inset px-3 py-2 font-mono text-[11px] leading-relaxed text-danger">
              {tab.error || "Unknown error"}
            </div>

            {tab.error?.includes("10060") && (
              <p className="mb-3 text-[11px] text-content-muted">
                The host didn't respond (timeout). Check the address/port, that the server is online,
                and that a firewall or VPN isn't blocking it.
              </p>
            )}
            {tab.error?.toLowerCase().includes("authentication") && (
              <p className="mb-3 text-[11px] text-content-muted">
                Authentication was rejected — verify the username, password, or SSH key.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => closeTab(tab.id)}>
                <X size={14} /> Close
              </button>
              {tab.kind === "ssh" && (
                <button className="btn-surface px-3 py-1.5 text-xs" onClick={() => setEditing(true)}>
                  <Pencil size={14} /> Edit host
                </button>
              )}
              <button
                className="btn-primary px-3 py-1.5 text-xs"
                onClick={() => {
                  const hid = tab.hostId;
                  closeTab(tab.id);
                  openHost(hid);
                }}
              >
                <RotateCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && host && <HostModal host={host} onClose={() => setEditing(false)} />}

      {searchOpen && (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-line-strong bg-bg-raised p-1 shadow-xl animate-fade-in">
          <input
            autoFocus
            className="w-44 bg-transparent px-2 py-1 text-xs text-content outline-none placeholder:text-content-faint"
            placeholder="Find in terminal…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.shiftKey ? findPrev() : findNext());
              if (e.key === "Escape") closeSearch();
            }}
          />
          <button className="btn-ghost p-1" title="Previous (Shift+Enter)" onClick={() => findPrev()}>
            <ArrowUp size={14} />
          </button>
          <button className="btn-ghost p-1" title="Next (Enter)" onClick={() => findNext()}>
            <ArrowDown size={14} />
          </button>
          <button className="btn-ghost p-1" title="Close (Esc)" onClick={closeSearch}>
            <X size={14} />
          </button>
        </div>
      )}

      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
