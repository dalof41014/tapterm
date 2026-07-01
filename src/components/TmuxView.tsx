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
import { collectPanes, parseLayout, type LayoutNode, type PaneRect, type TmuxWindow } from "../lib/tmuxLayout";

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
  // Set deterministically when the user issues a kill that will end the session
  // (the last pane, or the last window) so the resulting channel drop closes the
  // tab instead of auto-reattaching into a freshly recreated session. Cleared
  // when a windows snapshot shows survivors or on error.
  const expectingCloseRef = useRef(false);

  const setTabStatus = useStore((s) => s.setTabStatus);
  const closeTab = useStore((s) => s.closeTab);
  const host = useStore((s) => s.vault.hosts.find((h) => h.id === tab.hostId));
  const themeId = useStore((s) => s.terminalThemeId);
  const fontId = useStore((s) => s.terminalFontId);
  const resolvedFont = host?.font || fontId; // tmux is always host-backed

  const [windows, setWindows] = useState<TmuxWindow[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<number | null>(null);
  const [layouts, setLayouts] = useState<Record<number, LayoutNode>>({});
  const [focusedPane, setFocusedPane] = useState<number | null>(null);
  // Measured cell pixel size as STATE (mirrors cellSizeRef) so the split tree
  // re-renders its pixel-exact slots when the true cell box is measured.
  const [cellSize, setCellSize] = useState<{ w: number; h: number }>({ w: EST_CELL_W, h: EST_CELL_H });

  // Report the real client size to tmux (cols×rows from the container box and the
  // MEASURED cell size). Called again once a pane measures the true cell size, so
  // tmux relays out to actually fill the viewport instead of an estimate.
  const syncClientSize = useCallback(() => {
    const b = containerRef.current;
    if (!b || !b.offsetWidth || !b.offsetHeight) return;
    const { w, h } = cellSizeRef.current;
    // floor (not round): guarantees cols*cellW <= box so the grid fits inside the
    // viewport and tmux never tiles wider/taller than we can show (canonical model).
    const c = Math.max(2, Math.floor(b.offsetWidth / w));
    const r = Math.max(2, Math.floor(b.offsetHeight / h));
    if (c === lastDimsRef.current.cols && r === lastDimsRef.current.rows) return;
    lastDimsRef.current = { cols: c, rows: r };
    tmuxResize(tab.id, c, r).catch(() => {});
  }, [tab.id]);

  // A visible pane measured the true cell box → mirror it into state (re-renders
  // the pixel-exact slots) and re-report the client size to tmux so it relays out
  // to fill the viewport instead of the bootstrap estimate.
  const handleMeasured = useCallback(() => {
    const { w, h } = cellSizeRef.current;
    setCellSize((prev) =>
      Math.abs(prev.w - w) < 0.01 && Math.abs(prev.h - h) < 0.01 ? prev : { w, h },
    );
    syncClientSize();
  }, [syncClientSize]);

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
          cols: Math.max(2, Math.floor(b.offsetWidth / w)),
          rows: Math.max(2, Math.floor(b.offsetHeight / h)),
        };
      }
      return { cols: 80, rows: 24 };
    };

    const connect = () => {
      connectedThisTry = false;
      openedAt = Date.now();
      const { cols, rows } = computeDims();
      // Reset (don't pre-seed measured dims): the first real syncClientSize after
      // a pane measures the true cell box must always fire its refresh-client -C,
      // otherwise a matching rounded estimate would suppress it and the window
      // would keep tmux's default size. (BE also sends an initial refresh-client.)
      lastDimsRef.current = { cols: 0, rows: 0 };
      tmuxOpen(tab.id, tab.hostId, cols, rows, tab.tmuxSession ?? "tapterm-cc").catch((err) => {
        if (!disposed) onClosed(String(err));
      });
    };

    // tmux control-mode sessions live on the server, so a dropped channel just
    // means we detached — auto-reattach (tmux -CC new -A) with backoff. Rapid
    // exits (e.g. tmux not installed) accumulate and eventually give up.
    const onClosed = (errMsg?: string) => {
      if (disposed) return;
      // The user just killed the last pane/window → the session ended on purpose;
      // close the tab instead of auto-reattaching into a freshly recreated
      // session. Deterministic (a per-kill intent flag), not a wall-clock guard.
      if (expectingCloseRef.current) {
        expectingCloseRef.current = false;
        closeTab(tab.id);
        return;
      }
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
          // Survivors exist → whatever the user killed was not the last window;
          // cancel any pending close-tab intent so a later drop just reattaches.
          if (ws.length > 0) expectingCloseRef.current = false;
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
      // A rejected kill-window/kill-pane (stale @/% target, already gone) emits a
      // %error block → surface it instead of letting the button "do nothing". A
      // failed kill also voids any close-tab intent.
      const uError = await listen<{ message: string }>(
        `tmux://error/${tab.id}`,
        () => {
          // A command-level %error (e.g. a kill/query targeting an already-gone
          // pane during teardown) is NOT a connection failure — the session is
          // still alive. Do NOT mark the tab errored (red) and do NOT void the
          // close intent (killing the last window legitimately ends the session).
        },
      );
      if (disposed) {
        uOutput();
        uWindows();
        uLayout();
        uClosed();
        uError();
        return;
      }
      unlisteners.push(uOutput, uWindows, uLayout, uClosed, uError);
    })();

    connect();

    // Whole-viewport resize → refresh-client -C, using the measured cell size.
    const box = containerRef.current;
    let ro: ResizeObserver | undefined;
    if (box) {
      ro = new ResizeObserver(() => syncClientSize());
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
        onMeasured={handleMeasured}
        themeId={themeId}
        fontId={resolvedFont}
      />
    ),
    [tab.id, focusedPane, themeId, resolvedFont, handleMeasured],
  );

  // Resolve a concrete pane target: the focused pane, else the first leaf of the
  // selected window. Never issue kill-pane/split-window with an empty -t (which
  // would hit the server's active pane — possibly in a different window).
  const resolvePaneTarget = useCallback((): number | null => {
    if (focusedPane != null) return focusedPane;
    if (selectedWindow != null) {
      const tree = layouts[selectedWindow];
      if (tree) {
        const panes = collectPanes(tree);
        if (panes.length) return panes[0];
      }
    }
    return null;
  }, [focusedPane, selectedWindow, layouts]);

  // Would this kind of kill destroy the whole tapterm-cc session (→ close tab)?
  const willCloseTab = useCallback(
    (scope: "pane" | "window"): boolean => {
      if (windows.length > 1) return false; // other windows survive
      if (scope === "window") return true; // killing the only window
      if (selectedWindow == null) return false;
      const tree = layouts[selectedWindow];
      return tree ? collectPanes(tree).length <= 1 : false; // last pane of last window
    },
    [windows, selectedWindow, layouts],
  );

  // Structural commands (native UI drives tmux; in control mode there is no
  // prefix/key-table — see PaneTerminal). Shared by the switcher bar and the
  // keyboard accelerators below.
  const newWindow = useCallback(() => {
    tmuxCommand(tab.id, "new-window").catch(() => {});
  }, [tab.id]);

  const splitPane = useCallback(
    (dir: "h" | "v") => {
      const target = resolvePaneTarget();
      const t = target != null ? ` -t %${target}` : "";
      tmuxCommand(tab.id, `split-window -${dir}${t}`).catch(() => {});
    },
    [tab.id, resolvePaneTarget],
  );

  const closePane = useCallback(() => {
    const target = resolvePaneTarget();
    if (target == null) return; // nothing focused/known — don't kill a stray pane
    if (willCloseTab("pane")) expectingCloseRef.current = true;
    tmuxCommand(tab.id, `kill-pane -t %${target}`).catch(() => {});
  }, [tab.id, resolvePaneTarget, willCloseTab]);

  const closeWindow = useCallback(
    (w: number) => {
      const willClose = willCloseTab("window");
      if (willClose) expectingCloseRef.current = true;
      tmuxCommand(tab.id, `kill-window -t @${w}`).catch(() => {});
      if (willClose) return; // the tab itself will close via onClosed()
      // Optimistically drop the window now so it disappears immediately instead
      // of waiting on the backend re-bootstrap (which can lag/be swallowed by a
      // benign %error during teardown). A later windows snapshot reconciles.
      setWindows((ws) => ws.filter((x) => x.id !== w));
      setSelectedWindow((cur) => {
        if (cur !== w) return cur;
        const rest = windows.filter((x) => x.id !== w);
        const next = rest.find((x) => x.active) ?? rest[0];
        return next ? next.id : null;
      });
      setLayouts((m) => {
        if (!(w in m)) return m;
        const next = { ...m };
        delete next[w];
        return next;
      });
    },
    [tab.id, willCloseTab, windows],
  );

  const selectWindow = useCallback(
    (w: number) => {
      setSelectedWindow(w);
      tmuxCommand(tab.id, `select-window -t @${w}`).catch(() => {});
    },
    [tab.id],
  );

  // Reconcile focus against the live layout: after a pane is killed (or on a
  // window switch) drop a dangling focusedPane so the ring + split/close targets
  // never point at a gone pane.
  useEffect(() => {
    if (selectedWindow == null) return;
    const tree = layouts[selectedWindow];
    if (!tree) return;
    const panes = collectPanes(tree);
    if (!panes.length) return;
    setFocusedPane((cur) => (cur != null && panes.includes(cur) ? cur : panes[0]));
  }, [layouts, selectedWindow]);

  // Native GUI accelerators (capture phase, never forwarded to the pane) that
  // issue the same structural commands. Platform-aware modifiers that DON'T
  // collide with terminal usage: Cmd on macOS; Ctrl+Shift elsewhere (plain
  // Ctrl+letter is reserved for the shell, e.g. Ctrl-D = EOF, Ctrl-W = kill-word).
  useEffect(() => {
    const box = containerRef.current;
    if (!box) return;
    const isMac = /mac/i.test(navigator.userAgent);
    const onKey = (e: KeyboardEvent) => {
      const accel = isMac
        ? e.metaKey && !e.ctrlKey && !e.altKey
        : e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
      if (!accel) return;
      switch (e.key.toLowerCase()) {
        case "t":
          e.preventDefault();
          e.stopPropagation();
          newWindow();
          break;
        case "d":
          e.preventDefault();
          e.stopPropagation();
          splitPane("h");
          break;
        case "e":
          e.preventDefault();
          e.stopPropagation();
          splitPane("v");
          break;
        case "w":
          e.preventDefault();
          e.stopPropagation();
          closePane();
          break;
      }
    };
    box.addEventListener("keydown", onKey, true);
    return () => box.removeEventListener("keydown", onKey, true);
  }, [newWindow, splitPane, closePane]);

  return (
    <div className="flex h-full flex-col bg-[#0B1220]">
      <WindowSwitcherBar
        windows={windows}
        selected={selectedWindow}
        onSelect={selectWindow}
        onCloseWindow={closeWindow}
        onNewWindow={newWindow}
        onSplitH={() => splitPane("h")}
        onSplitV={() => splitPane("v")}
        onClosePane={closePane}
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
            // The grid is sized to EXACTLY cols*cellW × rows*cellH (via SplitPane)
            // and centered; the sub-cell remainder of the viewport is intentional
            // dead margin (iTerm2 gray-area model), never stretched into the panes.
            <div
              key={w.id}
              className="absolute inset-0 flex items-center justify-center overflow-hidden"
              style={{ display: w.id === selectedWindow ? "flex" : "none" }}
            >
              <SplitPane
                node={wtree}
                cellW={cellSize.w}
                cellH={cellSize.h}
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
  onMeasured?: () => void;
  themeId: string;
  fontId: string;
}

function PaneTerminal({
  tabId,
  paneId,
  rect,
  paneTermsRef,
  pendingOutputRef,
  cellSizeRef,
  focused,
  onFocus,
  onMeasured,
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
    // Measure the real cell size once (for the viewport → client-size math) — but
    // do NOT fit-to-pixels: the pane grid must equal tmux's pane size, otherwise
    // full-screen TUIs (htop) and the cursor end up misaligned. Read the TRUE cell
    // box from the render service of a VISIBLE pane (offsetWidth>0); a display:none
    // window's pane has zero size and would yield a garbage cell. proposeDimensions
    // is a fallback only — it pre-subtracts padding/scrollbar so its derived cell
    // is slightly inflated, making the reported grid a few cells short.
    try {
      if (el.offsetWidth && el.offsetHeight) {
        const cell = (
          term as unknown as {
            _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } };
          }
        )._core?._renderService?.dimensions?.css?.cell;
        if (cell && cell.width > 0 && cell.height > 0) {
          cellSizeRef.current = { w: cell.width, h: cell.height };
          onMeasured?.();
        } else {
          const prop = fit.proposeDimensions();
          if (prop && prop.cols > 0 && prop.rows > 0) {
            cellSizeRef.current = { w: el.offsetWidth / prop.cols, h: el.offsetHeight / prop.rows };
            onMeasured?.();
          }
        }
      }
    } catch {
      /* noop */
    }
    // Size the grid to tmux's exact pane cell dims.
    if (rect.w > 0 && rect.h > 0) {
      try {
        term.resize(rect.w, rect.h);
      } catch {
        /* noop */
      }
    }
    paneTermsRef.current.set(paneId, { term, fit, el });

    // Flush any output buffered before this pane's xterm existed.
    const pending = pendingOutputRef.current.get(paneId);
    if (pending && pending.length) {
      for (const d of pending) term.write(d);
      pendingOutputRef.current.delete(paneId);
    }

    // Keyboard model (control mode): a -CC client has no prefix/key-table, so
    // "sending Ctrl-B to tmux" is meaningless. We PASS THROUGH every keystroke as
    // bytes to the focused pane via send-keys -H (the program in the pane receives
    // Ctrl-B/Ctrl-D/etc. directly). tmux is driven STRUCTURALLY via control
    // commands from the switcher bar / native accelerators (see TmuxView), never
    // by forwarding a prefix.
    const onData = term.onData((d) => {
      tmuxInput(tabId, paneId, d).catch(() => {});
    });

    return () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, fontId]);

  // Keep the grid matched to tmux's pane size on every layout change.
  useEffect(() => {
    const entry = paneTermsRef.current.get(paneId);
    if (entry && rect.w > 0 && rect.h > 0) {
      try {
        entry.term.resize(rect.w, rect.h);
      } catch {
        /* noop */
      }
    }
  }, [rect.w, rect.h, paneId, paneTermsRef]);

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
  onCloseWindow: (w: number) => void;
  onNewWindow: () => void;
  onSplitH: () => void;
  onSplitV: () => void;
  onClosePane: () => void;
}

function WindowSwitcherBar({
  windows,
  selected,
  onSelect,
  onCloseWindow,
  onNewWindow,
  onSplitH,
  onSplitV,
  onClosePane,
}: WindowSwitcherBarProps) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-bg-raised px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {windows.map((w) => (
          <div
            key={w.id}
            className={`group/w flex shrink-0 items-center rounded-md transition-colors ${
              selected === w.id ? "bg-accent-soft" : "hover:bg-surface-hover"
            }`}
          >
            <button
              onClick={() => onSelect(w.id)}
              className={`py-1 pl-2 pr-1 text-xs ${
                selected === w.id ? "text-accent" : "text-content-muted group-hover/w:text-content"
              }`}
              title={`Window @${w.id}`}
            >
              {w.name || `@${w.id}`}
            </button>
            <button
              onClick={() => onCloseWindow(w.id)}
              title="Close window"
              className="rounded p-0.5 pr-1 text-content-faint opacity-0 transition-opacity hover:text-danger group-hover/w:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
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
