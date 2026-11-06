// Sidebar state: collapsed/expanded (persisted), automatic collapse on narrow screens, mobile drawer, recent-chats expansion.
//
//   collapsed = mobile ? false : override ?? (narrow ? true : pref)
//   - pref     the user's choice on wide screens, localStorage muster.sidebar.collapsed
//   - narrow   viewport < 1100px: collapsed to the 68px rail unless the user opens it temporarily (override)
//   - mobile   viewport < 768px: the sidebar becomes a left drawer (drawerOpen)
// Expanded width is drag-resizable in Shell (SIDEBAR_WIDTH, persisted in muster.sidebar.width); the rail stays 68px.
import { create } from "zustand";

export const SIDEBAR_KEY = "muster.sidebar.collapsed";
const RECENT_KEY = "muster.sidebar.recent";
/** Expanded sidebar width (px): persisted key, default and drag range. */
export const SIDEBAR_WIDTH = { storageKey: "muster.sidebar.width", defaultWidth: 224, min: 200, max: 360 } as const;
/** Releasing a sidebar drag narrower than this (px) snaps it to the rail. */
export const SIDEBAR_SNAP_PX = 140;
/** Narrower than this (px): auto-collapse to the rail. */
const NARROW_PX = 1100;
/** Narrower than this (px): navigation lives in a drawer. */
const MOBILE_PX = 768;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: in-memory only */
  }
}

interface SidebarState {
  pref: boolean;
  narrow: boolean;
  mobile: boolean;
  override: boolean | null;
  drawerOpen: boolean;
  /** Recent chats: false = first 4, true = more. */
  recentExpanded: boolean;
  toggle: () => void;
  setViewport: (v: { narrow: boolean; mobile: boolean }) => void;
  setDrawerOpen: (open: boolean) => void;
  toggleRecent: () => void;
}

const collapsedOf = (s: Pick<SidebarState, "pref" | "narrow" | "mobile" | "override">): boolean => !s.mobile && (s.override ?? (s.narrow ? true : s.pref));

export const useSidebar = create<SidebarState>((set, get) => ({
  pref: read(SIDEBAR_KEY) === "1",
  narrow: false,
  mobile: false,
  override: null,
  drawerOpen: false,
  recentExpanded: read(RECENT_KEY) === "1",
  toggle: () => {
    const s = get();
    if (s.mobile) return set({ drawerOpen: !s.drawerOpen });
    const next = !collapsedOf(s);
    if (s.narrow) set({ override: next });
    else {
      write(SIDEBAR_KEY, next ? "1" : "0");
      set({ pref: next, override: null });
    }
  },
  setViewport: ({ narrow, mobile }) => {
    const s = get();
    if (narrow !== s.narrow || mobile !== s.mobile) set({ narrow, mobile, override: null, drawerOpen: false });
  },
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleRecent: () => {
    const next = !get().recentExpanded;
    write(RECENT_KEY, next ? "1" : "0");
    set({ recentExpanded: next });
  },
}));

/** Whether the rail (68px) is shown. Always false in the mobile drawer. */
export const useCollapsed = (): boolean => useSidebar(collapsedOf);

/** Track the viewport width. Call once in Shell. Environments without matchMedia (jsdom) count as wide. */
export function watchViewport(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const narrow = window.matchMedia(`(max-width: ${NARROW_PX - 0.02}px)`);
  const mobile = window.matchMedia(`(max-width: ${MOBILE_PX - 0.02}px)`);
  const apply = () => useSidebar.getState().setViewport({ narrow: narrow.matches, mobile: mobile.matches });
  apply();
  narrow.addEventListener("change", apply);
  mobile.addEventListener("change", apply);
  return () => {
    narrow.removeEventListener("change", apply);
    mobile.removeEventListener("change", apply);
  };
}
