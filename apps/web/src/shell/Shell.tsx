// App shell: sidebar + a minimal global strip (connection banner, mobile menu button) + the routed page.
// Global hotkeys: Ctrl/⌘+K search, Ctrl/⌘+B sidebar. The expanded sidebar is drag-resizable from its right edge.
import { useEffect, useRef, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router";
import { MotionConfig } from "motion/react";
import { Menu } from "lucide-react";
import { Drawer, DrawerContent, IconButton, Toaster, TooltipProvider, useReducedMotion } from "@muster/ui";
import { ResizeHandle, useResizableWidth } from "../components/layout";
import { CommandSearch, useCommandSearch } from "./CommandSearch";
import { ConnectionBar } from "./ConnectionBar";
import { hasMod } from "./keys";
import { Sidebar } from "./Sidebar";
import { SIDEBAR_SNAP_PX, SIDEBAR_WIDTH, useCollapsed, useSidebar, watchViewport } from "./sidebarState";
import "./shell.css";

function useShellHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        const { open, setOpen } = useCommandSearch.getState();
        setOpen(!open);
      } else if (key === "b" && !(e.target instanceof HTMLElement && e.target.isContentEditable)) {
        e.preventDefault();
        useSidebar.getState().toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Inline sidebar plus its resize handle. The width reaches the sidebar through --sidebar-w (see shell.css). */
function SidebarSlot() {
  const collapsed = useCollapsed();
  const { width, resizing, handleProps } = useResizableWidth(SIDEBAR_WIDTH);
  return (
    <div data-sidebar-slot data-resizing={resizing || undefined} className="relative flex shrink-0" style={{ "--sidebar-w": `${width}px` } as CSSProperties}>
      <Sidebar />
      {!collapsed && <ResizeHandle label="调整侧栏宽度" edge="right" snapBelow={SIDEBAR_SNAP_PX} onSnap={() => useSidebar.getState().toggle()} {...handleProps} />}
    </div>
  );
}

export function Shell() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const mobile = useSidebar((s) => s.mobile);
  const drawerOpen = useSidebar((s) => s.drawerOpen);
  const setDrawerOpen = useSidebar((s) => s.setDrawerOpen);
  useShellHotkeys();
  useEffect(() => watchViewport(), []);
  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 });
    useSidebar.getState().setDrawerOpen(false);
  }, [pathname]);

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <TooltipProvider delayDuration={200}>
        <div className="flex h-full overflow-hidden bg-canvas">
          {!mobile && <SidebarSlot />}
          <div className="flex min-w-0 flex-1 flex-col">
            <header data-topbar className="shrink-0">
              {mobile && (
                <div className="flex h-12 items-center gap-2 border-b border-border px-3">
                  <IconButton label="打开导航" onClick={() => setDrawerOpen(true)}>
                    <Menu />
                  </IconButton>
                  <span className="text-section font-semibold">Muster</span>
                </div>
              )}
              <ConnectionBar />
            </header>
            <main ref={mainRef} id="main" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <Outlet />
            </main>
          </div>
        </div>
        {mobile && (
          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DrawerContent side="left" title="导航" width={280} bodyClassName="p-0" className="rounded-none">
              <Sidebar inDrawer />
            </DrawerContent>
          </Drawer>
        )}
        <CommandSearch />
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}
