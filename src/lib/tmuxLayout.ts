// tmux layout-string parser (net-new, Split agent).
//
// Grammar (LOCKED):
//   <layout>   = <checksum> "," <node>
//   <node>     = W "x" H "," X "," Y ( "," <paneId>            // leaf
//                                    | "{" <node> ("," <node>)* "}"   // left-right split
//                                    | "[" <node> ("," <node>)* "]" ) // top-bottom split
//   W,H,X,Y,paneId are decimal integers in tmux cell units.
//   "{}" = left-right (horizontal) split; "[]" = top-bottom (vertical) split.
//
// Self-checks (example strings — no test runner, just reference cases):
//   parseLayout("bf68,80x24,0,0,0")
//     => { x:0, y:0, w:80, h:24, dir:null, paneId:0 }
//   parseLayout("cb42,80x24,0,0{40x24,0,0,1,39x24,41,0,2}")
//     => lr split, children [leaf paneId 1, leaf paneId 2]; collectPanes => [1,2]
//   parseLayout("a1b2,80x24,0,0[80x12,0,0,3,80x11,0,13,4]")
//     => tb split, children [leaf paneId 3, leaf paneId 4]; collectPanes => [3,4]
//   parseLayout("d4e5,80x24,0,0{40x24,0,0,1,39x24,41,0[39x12,41,0,2,39x11,41,13,3]}")
//     => lr split: [leaf 1, tb split [leaf 2, leaf 3]]; collectPanes => [1,2,3]
//   parseLayout("garbage") => null
//   parseLayout("bf68,80x24,0,0{40x24,0,0,1}") (unterminated would also) => robust: returns null on mismatch

export interface LayoutNode {
  x: number;
  y: number;
  w: number;
  h: number; // tmux cell units
  dir: "lr" | "tb" | null; // null = leaf
  paneId?: number; // present iff dir === null
  children?: LayoutNode[]; // present iff dir !== null
}

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
} // shared with SplitPane / TmuxView

export interface TmuxWindow {
  id: number;
  name: string;
  active: boolean;
} // shared (windows event)

/** Internal recursive-descent cursor result. */
interface ParseResult {
  node: LayoutNode;
  pos: number;
}

function readNumber(s: string, pos: number): { value: number; pos: number } {
  const start = pos;
  while (pos < s.length) {
    const c = s.charCodeAt(pos);
    if (c < 48 || c > 57) break; // not 0-9
    pos++;
  }
  if (pos === start) throw new Error(`expected digits at ${start}`);
  return { value: parseInt(s.slice(start, pos), 10), pos };
}

function expectChar(s: string, pos: number, ch: string): number {
  if (s[pos] !== ch) throw new Error(`expected '${ch}' at ${pos}`);
  return pos + 1;
}

function parseNode(s: string, pos: number): ParseResult {
  // W x H , X , Y
  let r = readNumber(s, pos);
  const w = r.value;
  pos = expectChar(s, r.pos, "x");
  r = readNumber(s, pos);
  const h = r.value;
  pos = expectChar(s, r.pos, ",");
  r = readNumber(s, pos);
  const x = r.value;
  pos = expectChar(s, r.pos, ",");
  r = readNumber(s, pos);
  const y = r.value;
  pos = r.pos;

  const ch = s[pos];
  if (ch === ",") {
    // leaf: ,<paneId>
    r = readNumber(s, pos + 1);
    return { node: { x, y, w, h, dir: null, paneId: r.value }, pos: r.pos };
  }
  if (ch === "{" || ch === "[") {
    const dir: "lr" | "tb" = ch === "{" ? "lr" : "tb";
    const close = ch === "{" ? "}" : "]";
    pos++; // consume opener
    const children: LayoutNode[] = [];
    // children separated by ',', terminated by the matching close bracket
    for (;;) {
      const cr = parseNode(s, pos);
      children.push(cr.node);
      pos = cr.pos;
      if (s[pos] === ",") {
        pos++;
        continue;
      }
      if (s[pos] === close) {
        pos++;
        break;
      }
      throw new Error(`expected ',' or '${close}' at ${pos}`);
    }
    return { node: { x, y, w, h, dir, children }, pos };
  }
  throw new Error(`unexpected token '${ch ?? "<eof>"}' at ${pos}`);
}

/** Parse a raw tmux layout string (checksum-prefixed). Returns null on malformed input. */
export function parseLayout(layout: string): LayoutNode | null {
  try {
    const comma = layout.indexOf(",");
    if (comma < 0) return null;
    const body = layout.slice(comma + 1); // drop "<checksum>,"
    const { node } = parseNode(body, 0);
    return node;
  } catch {
    return null;
  }
}

/** All leaf pane ids in tree order (depth-first). */
export function collectPanes(node: LayoutNode): number[] {
  const out: number[] = [];
  const walk = (n: LayoutNode): void => {
    if (n.dir === null) {
      if (n.paneId !== undefined) out.push(n.paneId);
      return;
    }
    if (n.children) for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}
