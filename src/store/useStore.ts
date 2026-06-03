import { create } from "zustand";
import { nanoid } from "nanoid";
import * as api from "../lib/api";
import { AI_TOOLS, type AiTool } from "../lib/aiTools";
import {
  emptyVault,
  type Group,
  type Host,
  type PortForward,
  type Snippet,
  type SshKey,
  type VaultData,
  type VaultStatus,
} from "../lib/types";

// tiny localStorage helpers (persist UI prefs across restarts)
const ls = {
  get: (k: string, d = ""): string => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  getJSON: <T,>(k: string, d: T): T => {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  setJSON: (k: string, v: unknown) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};

export type SidebarView = "hosts" | "keys" | "snippets" | "forwards" | "known";
export type RightPanel = "none" | "sftp" | "snippets" | "forwards" | "themes" | "ai";
export type MainView = "terminals" | "files" | "hosts";

export interface Tab {
  id: string;
  hostId: string;
  title: string;
  status: "connecting" | "connected" | "closed" | "error";
  error?: string;
  kind: "ssh" | "local" | "telnet";
  /** Command auto-sent into the session once it's ready (e.g. an AI CLI). */
  startup?: string;
  /** Id of the AI tool this tab runs, if launched from the AI launcher. */
  aiTool?: string;
}

interface StoreState {
  // vault
  status: VaultStatus | null;
  vault: VaultData;
  // ui
  sidebarView: SidebarView;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  mainView: MainView;
  setMainView: (v: MainView) => void;
  hostSearch: string;
  setHostSearch: (s: string) => void;
  hostTag: string | null;
  setHostTag: (t: string | null) => void;
  searches: Record<string, string>;
  sftpCwd: Record<string, string>;
  setSftpCwd: (hostId: string, cwd: string) => void;
  fileLeftEndpoint: string;
  fileLeftCwd: string;
  fileRightEndpoint: string;
  fileRightCwd: string;
  setFilePane: (side: "left" | "right", endpoint: string, cwd: string) => void;
  recentHostIds: string[];
  rightPanel: RightPanel;
  search: string;
  activeForwards: Set<string>;
  collapsedGroups: Set<string>;
  gdriveConnected: boolean;
  setGdriveConnected: (v: boolean) => void;
  noPassword: boolean;
  setNoPassword: (v: boolean) => void;
  terminalThemeId: string;
  setTerminalTheme: (id: string) => void;
  terminalFontId: string;
  setTerminalFont: (id: string) => void;
  localFontId: string;
  setLocalFont: (id: string) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  // ai tools
  aiTools: AiTool[];
  addAiTool: (name: string, command: string) => void;
  removeAiTool: (id: string) => void;
  // tabs
  tabs: Tab[];
  activeTabId: string | null;

  // lifecycle
  refreshStatus: () => Promise<void>;
  loadVault: () => Promise<void>;
  persist: () => Promise<void>;

  // ui actions
  setSidebarView: (v: SidebarView) => void;
  setRightPanel: (p: RightPanel) => void;
  setSearch: (s: string) => void;

  // tab actions
  openHost: (hostId: string, opts?: { command?: string; title?: string; aiTool?: string }) => void;
  openLocal: (opts?: { command?: string; title?: string; aiTool?: string }) => void;
  closeTab: (tabId: string) => void;
  clearTabs: () => void;
  renameTab: (tabId: string, title: string) => void;
  setActiveTab: (tabId: string) => void;
  setTabStatus: (tabId: string, status: Tab["status"], error?: string) => void;

  // group CRUD
  saveGroup: (g: Group) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  toggleGroup: (id: string) => void;
  // host CRUD
  saveHost: (h: Host) => Promise<void>;
  duplicateHost: (id: string) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
  moveHostsToGroup: (ids: string[], groupId: string | null) => Promise<void>;
  deleteHosts: (ids: string[]) => Promise<void>;
  // key CRUD
  saveKey: (k: SshKey) => Promise<void>;
  deleteKey: (id: string) => Promise<void>;
  // snippet CRUD
  saveSnippet: (s: Snippet) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;
  // forward CRUD
  saveForward: (f: PortForward) => Promise<void>;
  deleteForward: (id: string) => Promise<void>;
  setForwardActive: (id: string, active: boolean) => void;
}

function upsert<T extends { id: string }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i === -1) return [...arr, item];
  const next = arr.slice();
  next[i] = item;
  return next;
}

export const useStore = create<StoreState>((set, get) => ({
  status: null,
  vault: emptyVault(),
  sidebarView: "hosts",
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  sidebarWidth: Math.min(480, Math.max(200, Number(ls.get("sidebar-width", "256")) || 256)),
  setSidebarWidth: (w) => {
    const clamped = Math.min(480, Math.max(200, Math.round(w)));
    ls.set("sidebar-width", String(clamped));
    set({ sidebarWidth: clamped });
  },
  mainView: "terminals",
  // entering File Transfer auto-collapses the host list for a wider view
  setMainView: (v) => set({ mainView: v, sidebarCollapsed: v === "files" }),
  hostSearch: ls.get("host-search"),
  setHostSearch: (s) => {
    ls.set("host-search", s);
    set({ hostSearch: s });
  },
  hostTag: ls.get("host-tag") || null,
  setHostTag: (t) => {
    ls.set("host-tag", t ?? "");
    set({ hostTag: t });
  },
  sftpCwd: ls.getJSON<Record<string, string>>("sftp-cwd", {}),
  setSftpCwd: (hostId, cwd) =>
    set((s) => {
      const next = { ...s.sftpCwd, [hostId]: cwd };
      ls.setJSON("sftp-cwd", next);
      return { sftpCwd: next };
    }),
  fileLeftEndpoint: ls.get("file-left-ep", "local"),
  fileLeftCwd: ls.get("file-left-cwd"),
  fileRightEndpoint: ls.get("file-right-ep", "local"),
  fileRightCwd: ls.get("file-right-cwd"),
  setFilePane: (side, endpoint, cwd) => {
    ls.set(`file-${side}-ep`, endpoint);
    ls.set(`file-${side}-cwd`, cwd);
    set(
      side === "left"
        ? { fileLeftEndpoint: endpoint, fileLeftCwd: cwd }
        : { fileRightEndpoint: endpoint, fileRightCwd: cwd },
    );
  },
  recentHostIds: ls.getJSON<string[]>("recent-hosts", []),
  rightPanel: "none",
  search: "",
  activeForwards: new Set(),
  collapsedGroups: new Set(),
  gdriveConnected: false,
  setGdriveConnected: (v) => set({ gdriveConnected: v }),
  noPassword: false,
  setNoPassword: (v) => set({ noPassword: v }),
  terminalThemeId:
    (typeof localStorage !== "undefined" && localStorage.getItem("term-theme")) || "tapterm",
  setTerminalTheme: (id) => {
    try {
      localStorage.setItem("term-theme", id);
    } catch {
      /* ignore */
    }
    set({ terminalThemeId: id });
  },
  terminalFontId:
    (typeof localStorage !== "undefined" && localStorage.getItem("term-font")) || "jetbrains",
  setTerminalFont: (id) => {
    try {
      localStorage.setItem("term-font", id);
    } catch {
      /* ignore */
    }
    set({ terminalFontId: id });
  },
  localFontId:
    (typeof localStorage !== "undefined" && localStorage.getItem("local-font")) || "jetbrains",
  setLocalFont: (id) => {
    try {
      localStorage.setItem("local-font", id);
    } catch {
      /* ignore */
    }
    set({ localFontId: id });
  },
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  // built-in AI tools (with curated commands) + any user-added custom tools
  aiTools: [
    ...AI_TOOLS,
    ...ls.getJSON<AiTool[]>("ai-tools-custom", []),
  ],
  addAiTool: (name, command) =>
    set((s) => {
      const tool: AiTool = { id: nanoid(8), name: name || command, command, commands: [] };
      const custom = [...ls.getJSON<AiTool[]>("ai-tools-custom", []), tool];
      ls.setJSON("ai-tools-custom", custom);
      return { aiTools: [...AI_TOOLS, ...custom] };
    }),
  removeAiTool: (id) =>
    set(() => {
      const custom = ls.getJSON<AiTool[]>("ai-tools-custom", []).filter((t) => t.id !== id);
      ls.setJSON("ai-tools-custom", custom);
      return { aiTools: [...AI_TOOLS, ...custom] };
    }),
  tabs: [],
  activeTabId: null,

  refreshStatus: async () => {
    const status = await api.vaultStatus();
    set({ status });
    if (status.unlocked) await get().loadVault();
  },

  loadVault: async () => {
    const vault = await api.vaultGet();
    set({ vault });
  },

  persist: async () => {
    await api.vaultSave(get().vault);
    // best-effort push to Google Drive after every change
    if (get().gdriveConnected) {
      api.gdrivePush().catch(() => {});
    }
  },

  setSidebarView: (v) =>
    set((s) => {
      const searches = { ...s.searches, [s.sidebarView]: s.search };
      return { sidebarView: v, search: searches[v] ?? "", searches };
    }),
  setRightPanel: (p) => set((s) => ({ rightPanel: s.rightPanel === p ? "none" : p })),
  searches: {},
  setSearch: (s) =>
    set((st) => ({ search: s, searches: { ...st.searches, [st.sidebarView]: s } })),

  openHost: (hostId, opts) => {
    const host = get().vault.hosts.find((h) => h.id === hostId);
    if (!host) return;
    const id = nanoid(8);
    const tab: Tab = {
      id,
      hostId,
      title: opts?.title ?? host.label,
      status: "connecting",
      kind: host.protocol === "telnet" ? "telnet" : "ssh",
      startup: opts?.command,
      aiTool: opts?.aiTool,
    };
    set((s) => {
      const recentHostIds = [hostId, ...s.recentHostIds.filter((x) => x !== hostId)].slice(0, 8);
      ls.setJSON("recent-hosts", recentHostIds);
      return { tabs: [...s.tabs, tab], activeTabId: id, recentHostIds };
    });
  },

  openLocal: (opts) => {
    const id = nanoid(8);
    const n = get().tabs.filter((t) => t.kind === "local").length + 1;
    const tab: Tab = {
      id,
      hostId: "",
      title: opts?.title ?? (n > 1 ? `Local ${n}` : "Local"),
      status: "connecting",
      kind: "local",
      startup: opts?.command,
      aiTool: opts?.aiTool,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
  },

  closeTab: (tabId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        s.activeTabId === tabId ? tabs[tabs.length - 1]?.id ?? null : s.activeTabId;
      return { tabs, activeTabId };
    }),

  clearTabs: () => set({ tabs: [], activeTabId: null }),

  renameTab: (tabId, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) })),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setTabStatus: (tabId, status, error) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, status, error } : t)),
    })),

  saveGroup: async (g) => {
    set((s) => ({ vault: { ...s.vault, groups: upsert(s.vault.groups, g) } }));
    await get().persist();
  },
  deleteGroup: async (id) => {
    // detach children groups and hosts, then remove the group
    set((s) => ({
      vault: {
        ...s.vault,
        groups: s.vault.groups
          .filter((x) => x.id !== id)
          .map((x) => (x.parentId === id ? { ...x, parentId: null } : x)),
        hosts: s.vault.hosts.map((h) => (h.groupId === id ? { ...h, groupId: null } : h)),
      },
    }));
    await get().persist();
  },
  toggleGroup: (id) =>
    set((s) => {
      const next = new Set(s.collapsedGroups);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { collapsedGroups: next };
    }),

  saveHost: async (h) => {
    set((s) => ({ vault: { ...s.vault, hosts: upsert(s.vault.hosts, h) } }));
    await get().persist();
  },
  duplicateHost: async (id) => {
    const h = get().vault.hosts.find((x) => x.id === id);
    if (!h) return;
    const copy: Host = { ...h, id: nanoid(10), label: `${h.label} (copy)`, tags: [...h.tags] };
    set((s) => ({ vault: { ...s.vault, hosts: [...s.vault.hosts, copy] } }));
    await get().persist();
  },
  deleteHost: async (id) => {
    set((s) => ({ vault: { ...s.vault, hosts: s.vault.hosts.filter((x) => x.id !== id) } }));
    await get().persist();
  },
  moveHostsToGroup: async (ids, groupId) => {
    const set2 = new Set(ids);
    set((s) => ({
      vault: {
        ...s.vault,
        hosts: s.vault.hosts.map((h) => (set2.has(h.id) ? { ...h, groupId } : h)),
      },
    }));
    await get().persist();
  },
  deleteHosts: async (ids) => {
    const set2 = new Set(ids);
    set((s) => ({ vault: { ...s.vault, hosts: s.vault.hosts.filter((h) => !set2.has(h.id)) } }));
    await get().persist();
  },

  saveKey: async (k) => {
    set((s) => ({ vault: { ...s.vault, keys: upsert(s.vault.keys, k) } }));
    await get().persist();
  },
  deleteKey: async (id) => {
    set((s) => ({ vault: { ...s.vault, keys: s.vault.keys.filter((x) => x.id !== id) } }));
    await get().persist();
  },

  saveSnippet: async (sn) => {
    set((s) => ({ vault: { ...s.vault, snippets: upsert(s.vault.snippets, sn) } }));
    await get().persist();
  },
  deleteSnippet: async (id) => {
    set((s) => ({
      vault: { ...s.vault, snippets: s.vault.snippets.filter((x) => x.id !== id) },
    }));
    await get().persist();
  },

  saveForward: async (f) => {
    set((s) => ({ vault: { ...s.vault, portForwards: upsert(s.vault.portForwards, f) } }));
    await get().persist();
  },
  deleteForward: async (id) => {
    set((s) => ({
      vault: { ...s.vault, portForwards: s.vault.portForwards.filter((x) => x.id !== id) },
    }));
    await get().persist();
  },

  setForwardActive: (id, active) =>
    set((s) => {
      const next = new Set(s.activeForwards);
      if (active) next.add(id);
      else next.delete(id);
      return { activeForwards: next };
    }),
}));
