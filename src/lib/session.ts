import { localSend, sshSend, telnetSend } from "./api";

/** Send a snippet/command into a live terminal session (by tab id). */
export async function runSnippet(
  tabId: string,
  command: string,
  kind: "ssh" | "local" | "telnet" | "tmux" = "ssh",
) {
  // tmux multiplexes panes over a single control stream; a snippet has no target
  // pane here (focus lives in TmuxView, not the store), and writing to the raw
  // control stream would corrupt it — so snippet/AI injection is a no-op for tmux.
  if (kind === "tmux") return;
  const text = command.endsWith("\n") ? command : command + "\n";
  const send = kind === "telnet" ? telnetSend : kind === "local" ? localSend : sshSend;
  await send(tabId, text);
}
