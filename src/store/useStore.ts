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
export type MainView = "terminals" | "files";

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
  setActiveTab: (tabId: string) => void;
  setTabStatus: (tabId: string, status: Tab["status"], error?: string) => void;

  // group CRUD
  saveGroup: (g: Group) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  toggleGroup: (id: string) => void;
  // host CRUD
  saveHost: (h: Host) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
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
  deleteHost: async (id) => {
    set((s) => ({ vault: { ...s.vault, hosts: s.vault.hosts.filter((x) => x.id !== id) } }));
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
