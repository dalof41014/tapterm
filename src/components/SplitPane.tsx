// Recursive split-pane renderer for the tmux MVP (net-new, Split agent).
//
// Renders a parsed tmux LayoutNode tree as nested flex containers. Every slot is
// sized in EXACT PIXELS = cells × cellPx (Model B from the integration guide), so
// each pane's DOM slot equals the intrinsic pixel size of its xterm (cols*cellW ×
// rows*cellH). This is what makes panes tile with no internal black margin and
// keeps full-screen TUIs aligned — flex *proportions* could never do that, since
// pane pixels (cells) and slot pixels (container fraction) come from different
// bases. tmux reserves exactly one cell per divider between siblings (child cells
// sum to parent − (n−1)); we mirror that by giving each divider a 1-cell slot, so
// the children + dividers sum exactly to the parent's cols*cellW / rows*cellH.
//
// Style: app Tailwind tokens — dividers use the `line` color, focus ring uses
// `accent`.

import { Fragment, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import clsx from "clsx";
import { collectPanes, type LayoutNode, type PaneRect } from "../lib/tmuxLayout";

export interface SplitPaneProps {
  node: LayoutNode;
  /** Measured cell pixel size; the whole tree is laid out in cells × these. */
  cellW: number;
  cellH: number;
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
  const { node, cellW, cellH, focusedPane, onFocusPane, renderLeaf } = props;

  // Leaf: a fixed-size slot (cells × cellPx) hosting the caller's renderLeaf
  // output. The xterm inside resizes to the same cells, so it fills exactly.
  if (node.dir === null) {
    const id = node.paneId!;
    const focused = focusedPane === id;
    return (
      <div
        className={clsx(
          "relative shrink-0 overflow-hidden",
          focused && "z-10 ring-1 ring-inset ring-accent",
        )}
        style={{ width: node.w * cellW, height: node.h * cellH }}
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
  const { node, cellW, cellH, onResizePane } = props;
  const children = node.children ?? [];
  const isRow = node.dir === "lr";
  const cellPx = isRow ? cellW : cellH; // active-axis cell size
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Base grow values come straight from tmux cell sizes on the active axis. They
  // double as the per-child cell counts that drive each slot's pixel flex-basis.
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
      className={clsx("flex shrink-0", isRow ? "flex-row" : "flex-col")}
      style={{ width: node.w * cellW, height: node.h * cellH }}
    >
      {children.map((child, i) => (
        <Fragment key={i}>
          {/* Pixel-exact slot: cells × cellPx. flexGrow/Shrink 0 so it never
              stretches past the xterm's intrinsic size (the black-margin bug). */}
          <div
            className="relative overflow-hidden"
            style={{ flexGrow: 0, flexShrink: 0, flexBasis: grows[i] * cellPx }}
          >
            <SplitPane {...props} node={child} />
          </div>
          {i < children.length - 1 && (
            // Divider occupies the single cell tmux reserves between siblings, so
            // the slots + dividers sum exactly to the parent grid. The thin line
            // is centered inside that cell; the whole cell is the drag hit-target.
            <div
              className={clsx(
                "group relative z-10 flex shrink-0 select-none touch-none items-center justify-center",
                isRow ? "cursor-col-resize" : "cursor-row-resize",
              )}
              style={{ flexGrow: 0, flexShrink: 0, flexBasis: cellPx }}
              onPointerDown={onDividerDown(i)}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
            >
              <div
                className={clsx(
                  "bg-line transition-colors group-hover:bg-accent",
                  isRow ? "h-full w-px" : "h-px w-full",
                )}
              />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
