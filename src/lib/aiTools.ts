// Curated AI CLI tool definitions. Tapterm launches the user's already-installed
// CLIs in a local terminal and tags the tab with the tool id; the AI command
// panel then shows that tool's common commands. Tapterm stores no API keys —
// each CLI authenticates itself via the inherited shell environment.
//
// Command sets are curated/common for now. They are structured so per-version
// sets (via `<tool> --version`) can slot in later without changing the UI.

export interface AiCommand {
  /** Human label shown in the command panel. */
  label: string;
  /** Text sent into the running terminal session (a newline is appended). */
  command: string;
  /** Optional one-line description. */
  hint?: string;
}

export interface AiTool {
  id: string;
  /** Display name. */
  name: string;
  /** Executable typed into the shell to launch it, and probed on PATH. */
  command: string;
  /** Built-in tools cannot be removed in Settings. */
  builtin?: boolean;
  /** Curated commands shown in the right-side panel for this tool. */
  commands: AiCommand[];
}

/** Strip ANSI / VT escape sequences from captured terminal output. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC sequences
    .replace(/\x1b[@-Z\\-_]/g, "") // other two-char escapes
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // stray control chars (keep \n \t)
}

function humanize(cmd: string): string {
  const base = cmd.replace(/^\//, "").replace(/[-_:]+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : cmd;
}

/**
 * Best-effort parse of a tool's interactive `/help` output into commands.
 * Picks lines that begin with a single `/token` and captures any trailing
 * description. Ignores filesystem-looking paths (a second slash). Interactive
 * output is noisy, so this is advisory — the curated list stays as a fallback.
 */
export function parseSlashCommands(raw: string): AiCommand[] {
  const text = stripAnsi(raw);
  const seen = new Set<string>();
  const out: AiCommand[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s│|>*•\-–—]+/, "").trimEnd();
    const m = line.match(/^(\/[A-Za-z][A-Za-z0-9_-]*)(?:\s+[-—:]?\s*(.*))?$/);
    if (!m) continue;
    const command = m[1];
    if (command.length < 2 || command.length > 24 || seen.has(command)) continue;
    seen.add(command);
    const hint = (m[2] ?? "").trim().slice(0, 80) || undefined;
    out.push({ label: humanize(command), command, hint });
    if (out.length >= 60) break;
  }
  return out;
}

export const AI_TOOLS: AiTool[] = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    builtin: true,
    commands: [
      { label: "Help", command: "/help", hint: "List available commands" },
      { label: "Clear conversation", command: "/clear", hint: "Reset the current session" },
      { label: "Compact context", command: "/compact", hint: "Summarize to free up context" },
      { label: "Switch model", command: "/model", hint: "Choose the active model" },
      { label: "Token cost", command: "/cost", hint: "Show token usage this session" },
      { label: "Init project", command: "/init", hint: "Generate a CLAUDE.md" },
      { label: "Review changes", command: "/review", hint: "Review pending edits" },
      { label: "Config", command: "/config", hint: "Open configuration" },
      { label: "Login", command: "/login", hint: "Authenticate" },
      { label: "Logout", command: "/logout", hint: "Sign out" },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    builtin: true,
    commands: [
      { label: "Help", command: "/help", hint: "List available commands" },
      { label: "Switch model", command: "/model", hint: "Choose the active model" },
      { label: "Approval mode", command: "/approvals", hint: "Change command approval policy" },
      { label: "New session", command: "/new", hint: "Start a fresh conversation" },
      { label: "Clear", command: "/clear", hint: "Clear the screen" },
      { label: "Show diff", command: "/diff", hint: "Show pending git changes" },
      { label: "Compact context", command: "/compact", hint: "Summarize to free up context" },
      { label: "Quit", command: "/quit", hint: "Exit Codex" },
    ],
  },
  {
    id: "kiro",
    name: "Kiro CLI",
    command: "kiro-cli",
    builtin: true,
    commands: [
      { label: "Help", command: "/help", hint: "List available commands" },
      { label: "Clear", command: "/clear", hint: "Clear the conversation" },
      { label: "Tools", command: "/tools", hint: "List available tools" },
      { label: "Quit", command: "/quit", hint: "Exit Kiro CLI" },
    ],
  },
];
