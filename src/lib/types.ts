export type AuthMethod =
  | { kind: "Password"; value: string }
  | { kind: "Key"; value: string } // SshKey id
  | { kind: "Agent" };

export interface Group {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface Host {
  id: string;
  label: string;
  address: string;
  port: number;
  username: string;
  auth: AuthMethod;
  groupId?: string | null;
  os?: string | null;
  color?: string | null;
  tags: string[];
  jumpHostId?: string | null;
  font?: string | null;
  protocol?: "ssh" | "telnet" | null;
  persistent?: boolean;
  persistSession?: string | null;
}

export interface SshKey {
  id: string;
  label: string;
  privateKey: string;
  passphrase?: string | null;
  publicKey?: string | null;
}

export interface Snippet {
  id: string;
  label: string;
  command: string;
  group?: string | null;
}

export type ForwardKind = "Local" | "Remote" | "Dynamic";

export interface PortForward {
  id: string;
  label: string;
  hostId: string;
  kind: ForwardKind;
  bindAddress: string;
  bindPort: number;
  destHost?: string | null;
  destPort?: number | null;
}

export interface VaultData {
  groups: Group[];
  hosts: Host[];
  keys: SshKey[];
  snippets: Snippet[];
  portForwards: PortForward[];
}

export interface SftpEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export interface SftpListing {
  cwd: string;
  entries: SftpEntry[];
}

export interface KnownHost {
  host: string;
  fingerprint: string;
  keyType: string;
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
}

export interface SyncStatus {
  mode: "local" | "folder" | "gdrive";
  vaultPath: string;
  folderPath?: string | null;
  gdriveConnected: boolean;
  gdriveEmail?: string | null;
  gdriveHasCredentials: boolean;
  noPassword: boolean;
}

export const emptyVault = (): VaultData => ({
  groups: [],
  hosts: [],
  keys: [],
  snippets: [],
  portForwards: [],
});
