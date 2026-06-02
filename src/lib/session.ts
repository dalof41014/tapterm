import { localSend, sshSend } from "./api";

/** Send a snippet/command into a live terminal session (by tab id). */
export async function runSnippet(tabId: string, command: string, kind: "ssh" | "local" = "ssh") {
  const text = command.endsWith("\n") ? command : command + "\n";
  await (kind === "local" ? localSend : sshSend)(tabId, text);
}
