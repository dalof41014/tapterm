//! tmux control-mode (`-CC`) session management.
//!
//! Reuses `ssh.rs` for connection/auth (russh 0.45 legacy API) and mirrors the
//! `local.rs`/`telnet.rs` Manager shape. A single SSH shell channel runs
//! `tmux -CC new -A -s <session>`; the control protocol is parsed line-by-line
//! and surfaced to the frontend through structured `tmux://…/<id>` events.
//!
//! Detach, never kill: closing a tab drops the channel (EOF) so the tmux server
//! keeps the session alive — no `kill-session` is ever sent.

use crate::ssh::{ConnectParams, SshManager};
use russh::{ChannelMsg, Disconnect, Pty};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};

// ---- bootstrap / resync command ----------------------------------------------

/// `list-windows` format: one line per window, fields separated by US (0x1F):
/// `window_id`, `window_name`, `window_active` (1/0), `window_layout`.
const BOOTSTRAP_CMD: &str =
    "list-windows -F '#{window_id}\u{1f}#{window_name}\u{1f}#{?window_active,1,0}\u{1f}#{window_layout}'";

fn bootstrap_send() -> (String, Pending) {
    (BOOTSTRAP_CMD.to_string(), Pending::ListWindows)
}

// ---- emitted event payloads (LOCKED shapes) ----------------------------------

#[derive(Clone, serde::Serialize)]
struct OutputEvt {
    pane: u32,
    data: String,
}

#[derive(Clone, serde::Serialize)]
struct WindowJson {
    id: u32,
    name: String,
    active: bool,
}

#[derive(Clone, serde::Serialize)]
struct WindowsEvt {
    windows: Vec<WindowJson>,
}

#[derive(Clone, serde::Serialize)]
struct LayoutEvt {
    window: u32,
    layout: String,
}

#[derive(Clone, serde::Serialize)]
struct ErrorEvt {
    message: String,
}

/// Fully-formed payloads the parser wants emitted, in order.
enum Emit {
    Output(OutputEvt),
    Windows(WindowsEvt),
    Layout(LayoutEvt),
    Error(ErrorEvt),
}

fn emit(app: &AppHandle, id: &str, e: Emit) {
    match e {
        Emit::Output(p) => {
            let _ = app.emit(&format!("tmux://output/{id}"), p);
        }
        Emit::Windows(p) => {
            let _ = app.emit(&format!("tmux://windows/{id}"), p);
        }
        Emit::Layout(p) => {
            let _ = app.emit(&format!("tmux://layout/{id}"), p);
        }
        Emit::Error(p) => {
            let _ = app.emit(&format!("tmux://error/{id}"), p);
        }
    }
}

// ---- manager + command channel -----------------------------------------------

enum TmuxCmd {
    Send(String), // a full tmux command line (no trailing newline)
    Resize { cols: u16, rows: u16 },
    Close,
}

#[derive(Clone)]
pub struct TmuxManager {
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<TmuxCmd>>>>,
    ssh: SshManager, // cloned from AppState.ssh; used only for connect()
}

impl TmuxManager {
    pub fn new(ssh: SshManager) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            ssh,
        }
    }

    pub async fn open(
        &self,
        app: AppHandle,
        id: String,
        params: ConnectParams,
        session: String,
    ) -> anyhow::Result<()> {
        let (handle, keepalive) = self.ssh.connect(&params).await?; // reuse TOFU/auth/jump
        let channel = handle.channel_open_session().await?;
        channel
            .request_pty(
                false,
                "xterm-256color",
                params.cols as u32,
                params.rows as u32,
                0,
                0,
                &[
                    (Pty::ECHO, 1),
                    (Pty::TTY_OP_ISPEED, 14400),
                    (Pty::TTY_OP_OSPEED, 14400),
                ],
            )
            .await?;
        channel.request_shell(true).await?;

        let (tx, mut rx) = mpsc::unbounded_channel::<TmuxCmd>();
        self.sessions.lock().await.insert(id.clone(), tx);
        let sessions = self.sessions.clone();

        tokio::spawn(async move {
            let _keepalive = keepalive; // keep jump-host tunnels open for the session
            let mut channel = channel;
            let mut parser = Parser::new();

            // 1. Launch control mode (NOT enqueued — it is a shell command, not a
            //    control reply).
            let _ = channel
                .data(format!("tmux -CC new -A -s {session}\n").as_bytes())
                .await;

            loop {
                tokio::select! {
                    msg = channel.wait() => match msg {
                        Some(ChannelMsg::Data { ref data })
                        | Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            let out = parser.feed_bytes(data);
                            for evt in out.emits {
                                emit(&app, &id, evt);
                            }
                            // Parser-requested commands: every line written enqueues
                            // exactly one Pending so %begin/%end blocks match FIFO.
                            for (line, pend) in out.sends {
                                let _ = channel.data(format!("{line}\n").as_bytes()).await;
                                parser.pending.push_back(pend);
                            }
                            if out.closed {
                                break;
                            }
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                        _ => {}
                    },
                    cmd = rx.recv() => match cmd {
                        Some(TmuxCmd::Send(line)) => {
                            let _ = channel.data(format!("{line}\n").as_bytes()).await;
                            parser.pending.push_back(Pending::Generic);
                        }
                        Some(TmuxCmd::Resize { cols, rows }) => {
                            let _ = channel
                                .data(format!("refresh-client -C {cols}x{rows}\n").as_bytes())
                                .await;
                            parser.pending.push_back(Pending::Generic);
                        }
                        Some(TmuxCmd::Close) | None => {
                            let _ = channel.eof().await;
                            break;
                        }
                    }
                }
            }

            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "en")
                .await;
            sessions.lock().await.remove(&id);
            let _ = app.emit(&format!("tmux://closed/{id}"), ()); // detach => session persists
        });

        Ok(())
    }

    /// Send raw keystroke bytes to a pane, encoded as `send-keys -H` hex pairs.
    pub async fn input(&self, id: &str, pane: u32, data: Vec<u8>) {
        let line = format!("send-keys -t %{pane} -H {}", hex_pairs(&data));
        if let Some(tx) = self.sessions.lock().await.get(id) {
            let _ = tx.send(TmuxCmd::Send(line));
        }
    }

    /// Send a raw tmux command line (fire-and-forget).
    pub async fn command(&self, id: &str, cmd: String) {
        if let Some(tx) = self.sessions.lock().await.get(id) {
            let _ = tx.send(TmuxCmd::Send(cmd));
        }
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) {
        if let Some(tx) = self.sessions.lock().await.get(id) {
            let _ = tx.send(TmuxCmd::Resize { cols, rows });
        }
    }

    pub async fn close(&self, id: &str) {
        if let Some(tx) = self.sessions.lock().await.get(id) {
            let _ = tx.send(TmuxCmd::Close);
        }
    }
}

// ---- keystroke hex encoding (`send-keys -H`) ---------------------------------

/// Space-separated lowercase byte pairs, e.g. `b"a\r"` -> `"61 0d"`.
fn hex_pairs(data: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(data.len() * 3);
    for (i, b) in data.iter().enumerate() {
        if i > 0 {
            s.push(' ');
        }
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

// ---- octal decoder for `%output` (LOCKED — inline, no crate) -----------------

/// `\\` -> `\`; `\ooo` (1–3 octal digits) -> that byte; `\<other>` -> `<other>`
/// literally; everything else verbatim.
fn decode_tmux_output(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            if b[i + 1] == b'\\' {
                out.push(b'\\');
                i += 2;
            } else if (b'0'..=b'7').contains(&b[i + 1]) {
                let mut v = 0u16;
                let mut k = 0;
                while k < 3 && i + 1 + k < b.len() && (b'0'..=b'7').contains(&b[i + 1 + k]) {
                    v = v * 8 + (b[i + 1 + k] - b'0') as u16;
                    k += 1;
                }
                out.push(v as u8);
                i += 1 + k;
            } else {
                out.push(b[i + 1]);
                i += 2;
            }
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    out
}

// ---- control-mode parser (LOCKED state machine) ------------------------------

#[derive(Clone, Copy)]
enum Pending {
    Generic,
    ListWindows,
    Capture(u32),
}

#[derive(Default)]
struct ParserOut {
    emits: Vec<Emit>,
    sends: Vec<(String, Pending)>, // command lines the parser wants written (+ Pending)
    closed: bool,
}

struct Parser {
    buf: Vec<u8>,                              // line accumulator
    pending: VecDeque<Pending>,                // FIFO; pushed by the loop after each write
    collecting: Option<(Pending, Vec<String>)>, // active %begin..%end block
    bootstrapped: bool,
    active: Option<u32>,                       // tmux's active window id
    windows: BTreeMap<u32, String>,            // window id -> name
    layouts: HashMap<u32, String>,             // window id -> raw layout string
    known_panes: HashSet<u32>,                 // panes already seeded via capture-pane
}

impl Parser {
    fn new() -> Self {
        Parser {
            buf: Vec::new(),
            pending: VecDeque::new(),
            collecting: None,
            bootstrapped: false,
            active: None,
            windows: BTreeMap::new(),
            layouts: HashMap::new(),
            known_panes: HashSet::new(),
        }
    }

    fn feed_bytes(&mut self, bytes: &[u8]) -> ParserOut {
        let mut out = ParserOut::default();
        self.buf.extend_from_slice(bytes);
        loop {
            let nl = match self.buf.iter().position(|&b| b == b'\n') {
                Some(p) => p,
                None => break,
            };
            let mut line: Vec<u8> = self.buf.drain(..=nl).collect();
            line.pop(); // drop '\n'
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8_lossy(&line).into_owned();
            self.process_line(&line, &mut out);
        }
        out
    }

    fn process_line(&mut self, line: &str, out: &mut ParserOut) {
        // Strip the control-mode DCS intro / ST terminator if they cling to a line
        // (tmux opens with `\x1bP1000p` before the first `%begin`).
        let mut s = line;
        if let Some(r) = s.strip_prefix("\u{1b}P1000p") {
            s = r;
        }
        if let Some(r) = s.strip_suffix("\u{1b}\\") {
            s = r;
        }

        // First `%`-prefixed line ever: kick off the bootstrap resync.
        if !self.bootstrapped && s.starts_with('%') {
            self.bootstrapped = true;
            out.sends.push(bootstrap_send());
        }

        if self.collecting.is_some() {
            if s.starts_with("%end") {
                let (pend, body) = self.collecting.take().unwrap();
                self.dispatch_block(pend, body, out);
            } else if s.starts_with("%error") {
                let (_pend, body) = self.collecting.take().unwrap();
                let message = if body.is_empty() {
                    s.strip_prefix("%error").unwrap_or(s).trim().to_string()
                } else {
                    body.join("\n")
                };
                out.emits.push(Emit::Error(ErrorEvt { message }));
            } else if let Some((_, body)) = self.collecting.as_mut() {
                body.push(s.to_string());
            }
        } else if s.starts_with("%begin") {
            let pend = self.pending.pop_front().unwrap_or(Pending::Generic);
            self.collecting = Some((pend, Vec::new()));
        } else if s.starts_with('%') {
            self.handle_notification(s, out);
        } else {
            // non-% line outside a block (shell banner, prompt, DCS noise) -> ignore
        }
    }

    fn handle_notification(&mut self, line: &str, out: &mut ParserOut) {
        let mut it = line.splitn(2, ' ');
        let cmd = it.next().unwrap_or("");
        let rest = it.next().unwrap_or("");
        match cmd {
            "%output" => {
                // rest = "%<pane> <data...>"  (data may contain literal spaces)
                let mut it2 = rest.splitn(2, ' ');
                let pane_tok = it2.next().unwrap_or("");
                let data_str = it2.next().unwrap_or("");
                if let Some(pane) = pane_tok.strip_prefix('%').and_then(|s| s.parse::<u32>().ok())
                {
                    let bytes = decode_tmux_output(data_str);
                    out.emits.push(Emit::Output(OutputEvt {
                        pane,
                        data: String::from_utf8_lossy(&bytes).to_string(),
                    }));
                }
            }
            "%layout-change" => {
                // rest = "@<win> <layout> [<visible-layout> <flags>]"
                let mut it2 = rest.splitn(2, ' ');
                let win_tok = it2.next().unwrap_or("");
                let layout = it2
                    .next()
                    .unwrap_or("")
                    .split(' ')
                    .next()
                    .unwrap_or("")
                    .to_string();
                if let Some(win) = win_tok.strip_prefix('@').and_then(|s| s.parse::<u32>().ok()) {
                    self.layouts.insert(win, layout.clone());
                    self.seed_panes_from_layout(&layout, out);
                    out.emits.push(Emit::Layout(LayoutEvt {
                        window: win,
                        layout,
                    }));
                }
            }
            "%window-add" | "%unlinked-window-add" => {
                out.sends.push(bootstrap_send());
            }
            "%window-close" => {
                if let Some(win) = parse_at(rest) {
                    self.windows.remove(&win);
                    self.layouts.remove(&win);
                    out.emits
                        .push(Emit::Windows(self.windows_snapshot()));
                }
            }
            "%window-renamed" => {
                // rest = "@<win> <name>"
                let mut it2 = rest.splitn(2, ' ');
                let win_tok = it2.next().unwrap_or("");
                let name = it2.next().unwrap_or("");
                if let Some(win) = win_tok.strip_prefix('@').and_then(|s| s.parse::<u32>().ok()) {
                    self.windows.insert(win, name.to_string());
                    out.emits
                        .push(Emit::Windows(self.windows_snapshot()));
                }
            }
            "%session-changed" | "%sessions-changed" => {
                out.sends.push(bootstrap_send());
            }
            "%exit" | "%client-detached" => {
                out.closed = true;
            }
            // ignored (TODO): %session-renamed, %pane-mode-changed, %continue, %pause
            _ => {}
        }
    }

    fn dispatch_block(&mut self, pend: Pending, body: Vec<String>, out: &mut ParserOut) {
        match pend {
            Pending::Generic => { /* discard */ }
            Pending::Capture(pane) => {
                // capture-pane output is NOT octal-escaped; pass raw + one trailing \n.
                let mut data = body.join("\n").into_bytes();
                data.push(b'\n');
                out.emits.push(Emit::Output(OutputEvt {
                    pane,
                    data: String::from_utf8_lossy(&data).to_string(),
                }));
            }
            Pending::ListWindows => {
                for line in &body {
                    let parts: Vec<&str> = line.split('\u{1f}').collect();
                    if parts.len() < 4 {
                        continue;
                    }
                    let id = match parts[0].trim_start_matches('@').parse::<u32>() {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let name = parts[1].to_string();
                    let active = parts[2];
                    let layout = parts[3].to_string();
                    self.windows.insert(id, name);
                    self.layouts.insert(id, layout.clone());
                    if active == "1" {
                        self.active = Some(id);
                    }
                    self.seed_panes_from_layout(&layout, out);
                }
                out.emits.push(Emit::Windows(self.windows_snapshot()));
                let ids: Vec<u32> = self.windows.keys().copied().collect();
                for id in ids {
                    if let Some(layout) = self.layouts.get(&id) {
                        out.emits.push(Emit::Layout(LayoutEvt {
                            window: id,
                            layout: layout.clone(),
                        }));
                    }
                }
            }
        }
    }

    fn windows_snapshot(&self) -> WindowsEvt {
        let windows = self
            .windows
            .iter()
            .map(|(id, name)| WindowJson {
                id: *id,
                name: name.clone(),
                active: self.active == Some(*id),
            })
            .collect();
        WindowsEvt { windows }
    }

    /// Parse the leaf pane ids out of a layout string and, for each unseen pane,
    /// request a one-shot `capture-pane` seed.
    fn seed_panes_from_layout(&mut self, layout: &str, out: &mut ParserOut) {
        for pane in leaf_pane_ids(layout) {
            if self.known_panes.insert(pane) {
                out.sends.push((
                    format!("capture-pane -p -e -J -t %{pane}"),
                    Pending::Capture(pane),
                ));
            }
        }
    }
}

/// First whitespace-delimited token of `s`, parsed as `@<u32>`.
fn parse_at(s: &str) -> Option<u32> {
    s.split(' ').next()?.strip_prefix('@')?.parse().ok()
}

// ---- layout leaf-pane extraction ---------------------------------------------
// Grammar: `<checksum>,<node>`; `<node>` = `WxH,X,Y` then one of `,<paneId>`
// (leaf) | `{child,child,…}` (lr split) | `[child,child,…]` (tb split).

fn leaf_pane_ids(layout: &str) -> Vec<u32> {
    // drop the checksum: slice from the first ',' + 1
    let s = match layout.find(',') {
        Some(p) => &layout[p + 1..],
        None => layout,
    };
    let b = s.as_bytes();
    let mut pos = 0usize;
    let mut out = Vec::new();
    let _ = parse_node_panes(b, &mut pos, &mut out);
    out
}

fn read_uint(b: &[u8], pos: &mut usize) -> Option<u32> {
    let start = *pos;
    while *pos < b.len() && b[*pos].is_ascii_digit() {
        *pos += 1;
    }
    if *pos == start {
        return None;
    }
    std::str::from_utf8(&b[start..*pos]).ok()?.parse().ok()
}

fn expect(b: &[u8], pos: &mut usize, c: u8) -> bool {
    if *pos < b.len() && b[*pos] == c {
        *pos += 1;
        true
    } else {
        false
    }
}

fn parse_node_panes(b: &[u8], pos: &mut usize, out: &mut Vec<u32>) -> bool {
    // WxH,X,Y
    if read_uint(b, pos).is_none()
        || !expect(b, pos, b'x')
        || read_uint(b, pos).is_none()
        || !expect(b, pos, b',')
        || read_uint(b, pos).is_none()
        || !expect(b, pos, b',')
        || read_uint(b, pos).is_none()
    {
        return false;
    }
    if *pos >= b.len() {
        return true;
    }
    match b[*pos] {
        b',' => {
            *pos += 1;
            if let Some(id) = read_uint(b, pos) {
                out.push(id);
            }
            true
        }
        b'{' => parse_children(b, pos, out, b'}'),
        b'[' => parse_children(b, pos, out, b']'),
        _ => true,
    }
}

fn parse_children(b: &[u8], pos: &mut usize, out: &mut Vec<u32>, close: u8) -> bool {
    *pos += 1; // consume '{' or '['
    loop {
        if !parse_node_panes(b, pos, out) {
            return false;
        }
        if *pos < b.len() && b[*pos] == b',' {
            *pos += 1;
            continue;
        }
        break;
    }
    expect(b, pos, close)
}
