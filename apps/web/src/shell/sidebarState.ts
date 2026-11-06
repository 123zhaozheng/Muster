// OWNER: U2. 侧栏状态：展开/收起（持久化）、窄屏自动收起、最近对话折叠。
//
//   collapsed = override ?? (窄屏 ? true : pref)
//   - pref      用户在宽屏下的选择，存 localStorage（muster.sidebar.collapsed）
//   - narrow    视口 < 1200px（matchMedia）
//   - override  窄屏下用户临时展开/收起；视口跨过 1200px 阈值时清除
import { create } from "zustand";

export const SIDEBAR_KEY = "muster.sidebar.collapsed";
export const RECENT_KEY = "muster.sidebar.recent";
/** 窄于该宽度（px）自动收起。 */
export const NARROW_PX = 1200;

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
    /* 隐私模式等：忽略，仅内存生效 */
  }
}

interface SidebarState {
  pref: boolean;
  narrow: boolean;
  override: boolean | null;
  recentOpen: boolean;
  toggle: () => void;
  setNarrow: (narrow: boolean) => void;
  toggleRecent: () => void;
}

export const collapsedOf = (s: Pick<SidebarState, "pref" | "narrow" | "override">): boolean => s.override ?? (s.narrow ? true : s.pref);

export const useSidebar = create<SidebarState>((set, get) => ({
  pref: read(SIDEBAR_KEY) === "1",
  narrow: false,
  override: null,
  recentOpen: read(RECENT_KEY) !== "0",
  toggle: () => {
    const s = get();
    const next = !collapsedOf(s);
    if (s.narrow) {
      set({ override: next });
    } else {
      write(SIDEBAR_KEY, next ? "1" : "0");
      set({ pref: next, override: null });
    }
  },
  setNarrow: (narrow) => {
    if (narrow !== get().narrow) set({ narrow, override: null });
  },
  toggleRecent: () => {
    const next = !get().recentOpen;
    write(RECENT_KEY, next ? "1" : "0");
    set({ recentOpen: next });
  },
}));

/** 当前是否收起。 */
export const useCollapsed = (): boolean => useSidebar(collapsedOf);

/** 跟踪视口宽度，窄于 1200px 时自动收起。在 Shell 里调用一次。无 matchMedia 的环境（jsdom）视为宽屏。 */
export function watchViewport(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(`(max-width: ${NARROW_PX - 0.02}px)`);
  const apply = () => useSidebar.getState().setNarrow(mq.matches);
  apply();
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}
