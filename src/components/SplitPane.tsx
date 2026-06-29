// Recursive split-pane renderer for the tmux MVP (net-new, Split agent).
//
// Renders a parsed tmux LayoutNode tree as nested flex containers whose child
// proportions follow tmux's cell ratios, with draggable dividers (pointer
// events) between siblings. Leaves are positioned slots into which the caller's
// renderLeaf(paneId, rect) is mounted (TmuxView mounts an xterm there).
//
// Style: app Tailwind tokens — borders/dividers use the `line` color, focus ring
// uses `accent`.

import { Fragment, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import clsx from "clsx";
import { collectPanes, type LayoutNode, type PaneRect } from "../lib/tmuxLayout";

export interface SplitPaneProps {
  node: LayoutNode;
  focusedPane: number | null;
  onFocusPane: (pane: number) => void;
  renderLeaf: (paneId: number, rect: PaneRect) => ReactNode;
  /** Optional; invoked at the end of a divider drag. dir: "x" for lr, "y" for tb. */
  onResizePane?: (pane: number, dir: "x" | "y", cells: number) => void;
}

/** First leaf pane id of a subtree (the representative target for resize-pane). */
function firstPaneId(node: LayoutNode): number | null {
  const panes = collectPanes(node);
  return panes.length ? panes[0] : null;
}

export function SplitPane(props: SplitPaneProps): JSX.Element {
  const { node, focusedPane, onFocusPane, renderLeaf } = props;

  // Leaf: a filled, focusable slot hosting the caller's renderLeaf output.
  if (node.dir === null) {
    const id = node.paneId!;
    const focused = focusedPane === id;
    return (
      <div
        className={clsx(
          "relative h-full w-full overflow-hidden",
          focused && "z-10 ring-1 ring-inset ring-accent",
        )}
        onMouseDown={() => onFocusPane(id)}
      >
        {renderLeaf(id, { x: node.x, y: node.y, w: node.w, h: node.h })}
      </div>
    );
  }

  // Split: delegate to a component so its hooks live on a stable node.
  return <SplitContainer {...props} />;
}

interface DragState {
  index: number; // divider sits between child[index] and child[index+1]
  startPos: number; // pointer coord on the active axis at drag start
  totalPx: number; // container size on the active axis
  startGrows: number[]; // grow values when the drag began
  live: number[]; // latest grow values during the drag
}

function SplitContainer(props: SplitPaneProps): JSX.Element {
  const { node, onResizePane } = props;
  const children = node.children ?? [];
  const isRow = node.dir === "lr";
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Base grow values come straight from tmux cell sizes on the active axis.
  const base = children.map((c) => (isRow ? c.w : c.h));
  const baseSig = `${node.dir}|${base.join(":")}`;

  // Local override for immediate drag feedback. Tagged with the base signature
  // so it auto-snaps back to tmux's allocation on the next %layout-change.
  const [override, setOverride] = useState<{ sig: string; grows: number[] } | null>(null);
  const grows = override && override.sig === baseSig ? override.grows : base;

  const onDividerDown = (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    dragRef.current = {
      index,
      startPos: isRow ? e.clientX : e.clientY,
      totalPx: isRow ? rect.width : rect.height,
      startGrows: grows.slice(),
      live: grows.slice(),
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture unsupported — drag still works via bubbling */
    }
  };

  const onDividerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.totalPx <= 0) return;
    const pos = isRow ? e.clientX : e.clientY;
    const sumGrow = d.startGrows.reduce((a, b) => a + b, 0);
    const deltaGrow = ((pos - d.startPos) / d.totalPx) * sumGrow;
    const i = d.index;
    const left = d.startGrows[i] + deltaGrow;
    const right = d.startGrows[i + 1] - deltaGrow;
    const min = 1; // keep at least ~1 cell on each side
    if (left < min || right < min) return;
    const next = d.startGrows.slice();
    next[i] = left;
    next[i + 1] = right;
    d.live = next;
    setOverride({ sig: baseSig, grows: next });
  };

  const onDividerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!onResizePane) return; // visual-only drag; snaps back on next layout
    const i = d.index;
    const leftPane = firstPaneId(children[i]);
    if (leftPane == null) return;
    const sumGrow = d.live.reduce((a, b) => a + b, 0);
    if (sumGrow <= 0) return;
    const parentCells = isRow ? node.w : node.h;
    const cells = Math.round(parentCells * (d.live[i] / sumGrow));
    onResizePane(leftPane, isRow ? "x" : "y", cells);
  };

  return (
    <div
      ref={containerRef}
      className={clsx("flex h-full w-full", isRow ? "flex-row" : "flex-col")}
    >
      {children.map((child, i) => (
        <Fragment key={i}>
          <div
            className="relative overflow-hidden"
            style={{ flexGrow: grows[i], flexBasis: 0, minWidth: 0, minHeight: 0 }}
          >
            <SplitPane {...props} node={child} />
          </div>
          {i < children.length - 1 && (
            <div
              className={clsx(
                "relative z-10 shrink-0 select-none touch-none bg-line transition-colors hover:bg-accent",
                isRow ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
              )}
              onPointerDown={onDividerDown(i)}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
