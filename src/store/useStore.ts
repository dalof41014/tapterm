import { create } from "zustand";
import { nanoid } from "nanoid";
import * as api from "../lib/api";
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

export type SidebarView = "hosts" | "keys" | "snippets" | "forwards" | "known";
export type RightPanel = "none" | "sftp" | "snippets" | "forwards" | "themes";
export type MainView = "terminals" | "files" | "hosts";

export interface Tab {
  id: string;
  hostId: string;
  title: string;
  status: "connecting" | "connected" | "closed" | "error";
  error?: string;
  kind: "ssh" | "local";
}

interface StoreState {
  // vault
  status: VaultStatus | null;
  vault: VaultData;
  // ui
  sidebarView: SidebarView;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  mainView: MainView;
  setMainView: (v: MainView) => void;
  hostSearch: string;
  setHostSearch: (s: string) => void;
  hostTag: string | null;
  setHostTag: (t: string | null) => void;
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
  openHost: (hostId: string) => void;
  openLocal: () => void;
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
  mainView: "terminals",
  // entering File Transfer auto-collapses the host list for a wider view
  setMainView: (v) => set({ mainView: v, sidebarCollapsed: v === "files" }),
  hostSearch: "",
  setHostSearch: (s) => set({ hostSearch: s }),
  hostTag: null,
  setHostTag: (t) => set({ hostTag: t }),
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

  setSidebarView: (v) => set({ sidebarView: v }),
  setRightPanel: (p) => set((s) => ({ rightPanel: s.rightPanel === p ? "none" : p })),
  setSearch: (s) => set({ search: s }),

  openHost: (hostId) => {
    const host = get().vault.hosts.find((h) => h.id === hostId);
    if (!host) return;
    const id = nanoid(8);
    const tab: Tab = { id, hostId, title: host.label, status: "connecting", kind: "ssh" };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
  },

  openLocal: () => {
    const id = nanoid(8);
    const n = get().tabs.filter((t) => t.kind === "local").length + 1;
    const tab: Tab = {
      id,
      hostId: "",
      title: n > 1 ? `Local ${n}` : "Local",
      status: "connecting",
      kind: "local",
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
