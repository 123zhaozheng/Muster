// Context-panel state shared by ChatLayout and the ChatHeader controls (docs/14 §6.1: closed until the user opens it).
//   >= 1440px: the panel is inline (340px by default, drag-resizable 300-560px), closed by default; the user's open/closed
//             choice is persisted (localStorage muster.contextPanel; width in muster.contextPanel.width).
//   <  1440px: the panel is closed by default and opens as a drawer (fixed width, not resizable); that state is not persisted.
import { create } from "zustand";

export const CONTEXT_PANEL_KEY = "muster.contextPanel";
/** Inline panel width (px): persisted key, default and drag range. */
export const CONTEXT_PANEL_WIDTH = { storageKey: "muster.contextPanel.width", defaultWidth: 340, min: 300, max: 560 } as const;
/** Inline panel from this viewport width up. */
const WIDE_PX = 1440;

function read(): "open" | "closed" | null {
  try {
    const v = localStorage.getItem(CONTEXT_PANEL_KEY);
    return v === "open" || v === "closed" ? v : null;
  } catch {
    return null;
  }
}

interface ContextPanelState {
  pref: "open" | "closed" | null;
  wide: boolean;
  drawerOpen: boolean;
  setWide: (wide: boolean) => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const isContextPanelOpen = (s: Pick<ContextPanelState, "pref" | "wide" | "drawerOpen">): boolean => (s.wide ? s.pref === "open" : s.drawerOpen);

export const useContextPanelStore = create<ContextPanelState>((set, get) => ({
  pref: read(),
  wide: true,
  drawerOpen: false,
  setWide: (wide) => {
    if (wide !== get().wide) set({ wide, drawerOpen: false });
  },
  setOpen: (open) => {
    if (get().wide) {
      try {
        localStorage.setItem(CONTEXT_PANEL_KEY, open ? "open" : "closed");
      } catch {
        /* private mode: in-memory only */
      }
      set({ pref: open ? "open" : "closed" });
    } else set({ drawerOpen: open });
  },
  toggle: () => get().setOpen(!isContextPanelOpen(get())),
}));

/** { open, toggle, setOpen, inline } for the current viewport. */
export function useContextPanel() {
  const open = useContextPanelStore(isContextPanelOpen);
  const inline = useContextPanelStore((s) => s.wide);
  const toggle = useContextPanelStore((s) => s.toggle);
  const setOpen = useContextPanelStore((s) => s.setOpen);
  return { open, inline, toggle, setOpen };
}

/** Track the viewport width. Called by ChatLayout while mounted. jsdom (no matchMedia) counts as wide. */
export function watchContextPanelViewport(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(`(min-width: ${WIDE_PX}px)`);
  const apply = () => useContextPanelStore.getState().setWide(mq.matches);
  apply();
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}
