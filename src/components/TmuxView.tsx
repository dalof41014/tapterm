// tmux control-mode (-CC) view (net-new, Frontend-integration agent).
//
// Subscribes to the backend `tmux://…/<tabId>` events, keeps one xterm per tmux
// pane id, and renders the active window as a split tree via SplitPane +
// parseLayout. Focused-pane keystrokes are routed through `tmux_input`
// (send-keys -H); the whole viewport is resized through `tmux_resize`
// (refresh-client -C). A small window-switcher bar drives the structural
// commands (select-window / new-window / split-window / kill-pane).

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Plus, SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import {
  tmuxClose,
  tmuxCommand,
  tmuxInput,
  tmuxOpen,
  tmuxResize,
} from "../lib/api";
import { useStore, type Tab } from "../store/useStore";
import { themeById } from "../lib/themes";
import { fontFamilyCss } from "../lib/fonts";
import { SplitPane } from "./SplitPane";
import { parseLayout, type LayoutNode, type PaneRect, type TmuxWindow } from "../lib/tmuxLayout";

interface PaneEntry {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
}

// Estimated cell size used only for the very first `tmux_open` cols/rows before
// any pane xterm has mounted to give a measured value (see cellSizeRef).
const EST_CELL_W = 13 * 0.6;
const EST_CELL_H = 13 * 1.3;

export function TmuxView({ tab }: { tab: Tab }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paneTermsRef = useRef<Map<number, PaneEntry>>(new Map());
  const pendingOutputRef = useRef<Map<number, string[]>>(new Map());
  const cellSizeRef = useRef<{ w: number; h: number }>({ w: EST_CELL_W, h: EST_CELL_H });
  const lastDimsRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });

  const setTabStatus = useStore((s) => s.setTabStatus);
  const host = useStore((s) => s.vault.hosts.find((h) => h.id === tab.hostId));
  const themeId = useStore((s) => s.terminalThemeId);
  const fontId = useStore((s) => s.terminalFontId);
  const resolvedFont = host?.font || fontId; // tmux is always host-backed

  const [windows, setWindows] = useState<TmuxWindow[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<number | null>(null);
  const [layouts, setLayouts] = useState<Record<number, LayoutNode>>({});
  const [focusedPane, setFocusedPane] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let attempts = 0;
    let openedAt = 0;
    let connectedThisTry = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const MAX_FAST = 6;
    const unlisteners: UnlistenFn[] = [];

    const computeDims = () => {
      const b = containerRef.current;
      if (b && b.offsetWidth && b.offsetHeight) {
        const { w, h } = cellSizeRef.current;
        return {
          cols: Math.max(2, Math.round(b.offsetWidth / w)),
          rows: Math.max(2, Math.round(b.offsetHeight / h)),
        };
      }
      return { cols: 80, rows: 24 };
    };

    const connect = () => {
      connectedThisTry = false;
      openedAt = Date.now();
      const { cols, rows } = computeDims();
      lastDimsRef.current = { cols, rows };
      tmuxOpen(tab.id, tab.hostId, cols, rows, tab.tmuxSession ?? "tapterm-cc").catch((err) => {
        if (!disposed) onClosed(String(err));
      });
    };

    // tmux control-mode sessions live on the server, so a dropped channel just
    // means we detached — auto-reattach (tmux -CC new -A) with backoff. Rapid
    // exits (e.g. tmux not installed) accumulate and eventually give up.
    const onClosed = (errMsg?: string) => {
      if (disposed) return;
      if (connectedThisTry || Date.now() - openedAt > 5000) attempts = 0;
      attempts += 1;
      if (attempts > MAX_FAST) {
        setTabStatus(
          tab.id,
          "error",
          errMsg || "tmux reconnect failed — is tmux installed on the host?",
        );
        for (const { term } of paneTermsRef.current.values())
          term.write("\r\n\x1b[31m[ tmux reconnect failed — check that tmux is installed ]\x1b[0m\r\n");
        return;
      }
      setTabStatus(tab.id, "connecting");
      for (const { term } of paneTermsRef.current.values())
        term.write("\r\n\x1b[2m[ disconnected — reattaching… ]\x1b[0m\r\n");
      const delay = Math.min(8000, 500 * 2 ** (attempts - 1));
      reconnectTimer = setTimeout(() => {
        if (!disposed) connect();
      }, delay);
    };

    (async () => {
      const uOutput = await listen<{ pane: number; data: string }>(
        `tmux://output/${tab.id}`,
        (e) => {
          const { pane, data } = e.payload;
          const entry = paneTermsRef.current.get(pane);
          if (entry) {
            entry.term.write(data);
          } else {
            const arr = pendingOutputRef.current.get(pane) ?? [];
            arr.push(data);
            pendingOutputRef.current.set(pane, arr);
          }
        },
      );
      const uWindows = await listen<{ windows: TmuxWindow[] }>(
        `tmux://windows/${tab.id}`,
        (e) => {
          const ws = e.payload.windows;
          setWindows(ws);
          setSelectedWindow((cur) => {
            if (cur != null && ws.some((w) => w.id === cur)) return cur;
            const active = ws.find((w) => w.active);
            return active ? active.id : ws.length ? ws[0].id : null;
          });
          if (!connectedThisTry) {
            connectedThisTry = true;
            attempts = 0;
            setTabStatus(tab.id, "connected");
          }
        },
      );
      const uLayout = await listen<{ window: number; layout: string }>(
        `tmux://layout/${tab.id}`,
        (e) => {
          const tree = parseLayout(e.payload.layout);
          if (!tree) return;
          setLayouts((m) => ({ ...m, [e.payload.window]: tree }));
        },
      );
      const uClosed = await listen(`tmux://closed/${tab.id}`, () => onClosed());
      if (disposed) {
        uOutput();
        uWindows();
        uLayout();
        uClosed();
        return;
      }
      unlisteners.push(uOutput, uWindows, uLayout, uClosed);
    })();

    connect();

    // Whole-viewport resize → refresh-client -C, using the measured cell size.
    const box = containerRef.current;
    let ro: ResizeObserver | undefined;
    if (box) {
      ro = new ResizeObserver(() => {
        const b = containerRef.current;
        if (!b || !b.offsetWidth || !b.offsetHeight) return; // hidden-tab guard
        const { w, h } = cellSizeRef.current;
        const c = Math.max(2, Math.round(b.offsetWidth / w));
        const r = Math.max(2, Math.round(b.offsetHeight / h));
        if (c === lastDimsRef.current.cols && r === lastDimsRef.current.rows) return;
        lastDimsRef.current = { cols: c, rows: r };
        tmuxResize(tab.id, c, r).catch(() => {});
      });
      ro.observe(box);
    }

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ro?.disconnect();
      for (const u of unlisteners) u();
      for (const { term } of paneTermsRef.current.values()) {
        try {
          term.dispose();
        } catch {
          /* already disposed by its PaneTerminal unmount */
        }
      }
      paneTermsRef.current.clear();
      pendingOutputRef.current.clear();
      tmuxClose(tab.id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  const renderLeaf = useCallback(
    (paneId: number, rect: PaneRect) => (
      <PaneTerminal
        tabId={tab.id}
        paneId={paneId}
        rect={rect}
        paneTermsRef={paneTermsRef}
        pendingOutputRef={pendingOutputRef}
        cellSizeRef={cellSizeRef}
        focused={focusedPane === paneId}
        onFocus={() => setFocusedPane(paneId)}
        themeId={themeId}
        fontId={resolvedFont}
      />
    ),
    [tab.id, focusedPane, themeId, resolvedFont],
  );

  return (
    <div className="flex h-full flex-col bg-[#0B1220]">
      <WindowSwitcherBar
        windows={windows}
        selected={selectedWindow}
        onSelect={(w) => {
          setSelectedWindow(w);
          tmuxCommand(tab.id, `select-window -t @${w}`).catch(() => {});
        }}
        onNewWindow={() => tmuxCommand(tab.id, "new-window").catch(() => {})}
        onSplitH={() =>
          focusedPane != null &&
          tmuxCommand(tab.id, `split-window -h -t %${focusedPane}`).catch(() => {})
        }
        onSplitV={() =>
          focusedPane != null &&
          tmuxCommand(tab.id, `split-window -v -t %${focusedPane}`).catch(() => {})
        }
        onClosePane={() =>
          focusedPane != null &&
          tmuxCommand(tab.id, `kill-pane -t %${focusedPane}`).catch(() => {})
        }
      />
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {windows.length === 0 && (
          <div className="p-3 text-xs opacity-60">connecting tmux…</div>
        )}
        {/* Keep every window mounted (display toggle) so switching windows never
            disposes a pane's xterm and loses its content. */}
        {windows.map((w) => {
          const wtree = layouts[w.id];
          if (!wtree) return null;
          return (
            <div
              key={w.id}
              className="absolute inset-0"
              style={{ display: w.id === selectedWindow ? "block" : "none" }}
            >
              <SplitPane
                node={wtree}
                focusedPane={focusedPane}
                onFocusPane={setFocusedPane}
                renderLeaf={renderLeaf}
                onResizePane={(pane, dir, cells) =>
                  tmuxCommand(tab.id, `resize-pane -t %${pane} -${dir} ${cells}`).catch(() => {})
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PaneTerminalProps {
  tabId: string;
  paneId: number;
  rect: PaneRect;
  paneTermsRef: React.MutableRefObject<Map<number, PaneEntry>>;
  pendingOutputRef: React.MutableRefObject<Map<number, string[]>>;
  cellSizeRef: React.MutableRefObject<{ w: number; h: number }>;
  focused: boolean;
  onFocus: () => void;
  themeId: string;
  fontId: string;
}

function PaneTerminal({
  tabId,
  paneId,
  paneTermsRef,
  pendingOutputRef,
  cellSizeRef,
  focused,
  onFocus,
  themeId,
  fontId,
}: PaneTerminalProps) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: fontFamilyCss(fontId),
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      theme: themeById(themeId),
      allowProposedApi: true,
      scrollback: 10000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      fit.fit();
    } catch {
      /* noop */
    }
    paneTermsRef.current.set(paneId, { term, fit, el });

    // Measure the real cell size once for the whole-viewport resize math.
    try {
      const prop = fit.proposeDimensions();
      if (prop && prop.cols > 0 && prop.rows > 0 && el.offsetWidth && el.offsetHeight) {
        cellSizeRef.current = { w: el.offsetWidth / prop.cols, h: el.offsetHeight / prop.rows };
      }
    } catch {
      /* noop */
    }

    // Flush any output buffered before this pane's xterm existed.
    const pending = pendingOutputRef.current.get(paneId);
    if (pending && pending.length) {
      for (const d of pending) term.write(d);
      pendingOutputRef.current.delete(paneId);
    }

    const onData = term.onData((d) => {
      tmuxInput(tabId, paneId, d).catch(() => {});
    });

    const ro = new ResizeObserver(() => {
      if (!el.offsetWidth || !el.offsetHeight) return;
      try {
        fit.fit();
      } catch {
        /* noop */
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      onData.dispose();
      if (paneTermsRef.current.get(paneId)?.term === term) paneTermsRef.current.delete(paneId);
      try {
        term.dispose();
      } catch {
        /* already disposed */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Live theme/font changes mirror TerminalView.
  useEffect(() => {
    const entry = paneTermsRef.current.get(paneId);
    if (!entry) return;
    entry.term.options.theme = themeById(themeId);
    entry.term.options.fontFamily = fontFamilyCss(fontId);
    try {
      entry.fit.fit();
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, fontId]);

  // Pull keyboard focus into this pane's xterm when it becomes focused.
  useEffect(() => {
    if (focused) paneTermsRef.current.get(paneId)?.term.focus();
  }, [focused, paneId, paneTermsRef]);

  return <div ref={elRef} className="h-full w-full" onMouseDown={onFocus} onFocus={onFocus} />;
}

interface WindowSwitcherBarProps {
  windows: TmuxWindow[];
  selected: number | null;
  onSelect: (w: number) => void;
  onNewWindow: () => void;
  onSplitH: () => void;
  onSplitV: () => void;
  onClosePane: () => void;
}

function WindowSwitcherBar({
  windows,
  selected,
  onSelect,
  onNewWindow,
  onSplitH,
  onSplitV,
  onClosePane,
}: WindowSwitcherBarProps) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-bg-raised px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {windows.map((w) => (
          <button
            key={w.id}
            onClick={() => onSelect(w.id)}
            className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
              selected === w.id
                ? "bg-accent-soft text-accent"
                : "text-content-muted hover:bg-surface-hover hover:text-content"
            }`}
            title={`Window @${w.id}`}
          >
            {w.name || `@${w.id}`}
          </button>
        ))}
        <button
          className="btn-ghost shrink-0 p-1"
          onClick={onNewWindow}
          title="New window"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button className="btn-ghost p-1" onClick={onSplitH} title="Split pane left/right">
          <SplitSquareHorizontal size={14} />
        </button>
        <button className="btn-ghost p-1" onClick={onSplitV} title="Split pane top/bottom">
          <SplitSquareVertical size={14} />
        </button>
        <button
          className="btn-ghost p-1 hover:text-danger"
          onClick={onClosePane}
          title="Close focused pane"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
