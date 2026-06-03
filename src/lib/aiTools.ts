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
