export interface TermFont {
  id: string;
  name: string;
  /** primary CSS font-family token (quoted). */
  family: string;
}

// Monospace fonts available for the terminal. JetBrains Mono and Cascadia Code
// NF are bundled/loaded for offline use; the rest come from Google Fonts.
export const FONTS: TermFont[] = [
  { id: "jetbrains", name: "JetBrains Mono", family: "'JetBrains Mono'" },
  { id: "cascadia-nf", name: "Cascadia Code NF", family: "'CascadiaCodeNF'" },
  { id: "fira-code", name: "Fira Code", family: "'Fira Code'" },
  { id: "source-code-pro", name: "Source Code Pro", family: "'Source Code Pro'" },
  { id: "ibm-plex-mono", name: "IBM Plex Mono", family: "'IBM Plex Mono'" },
  { id: "inconsolata", name: "Inconsolata", family: "'Inconsolata'" },
  { id: "ubuntu-mono", name: "Ubuntu Mono", family: "'Ubuntu Mono'" },
  { id: "space-mono", name: "Space Mono", family: "'Space Mono'" },
  { id: "anonymous-pro", name: "Anonymous Pro", family: "'Anonymous Pro'" },
];

export function fontFamilyCss(id?: string | null): string {
  const f = FONTS.find((x) => x.id === id);
  return `${f?.family ?? "'JetBrains Mono'"}, ui-monospace, Menlo, Consolas, monospace`;
}

export function fontName(id?: string | null): string {
  return FONTS.find((x) => x.id === id)?.name ?? "Default";
}
