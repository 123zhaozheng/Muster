// OWNER: U2. 外壳 v2：可收起侧栏 + 顶部条 + 内容区（路由过渡）+ 命令面板 + Toaster + 连接横幅。
// 全局快捷键：Ctrl/⌘+K 命令面板，Ctrl/⌘+B 切换侧栏。
import { useEffect, useRef, type ComponentType } from "react";
import { Outlet, useLocation } from "react-router";
import { MotionConfig, motion } from "motion/react";
import * as UI from "@muster/ui";
import { TooltipProvider } from "@muster/ui";
import { CommandPalette, useCommandPalette } from "./CommandPalette";
import { ConnectionBar } from "./ConnectionBar";
import { hasMod } from "./keys";
import { Sidebar } from "./Sidebar";
import { useSidebar, watchViewport } from "./sidebarState";
import { TopBar } from "./TopBar";
import "../components/layout/layout.css";

/** U1 提供 <Toaster/> 之后自动生效；没有时安静地跳过（不硬依赖，避免并行开发期间编译失败）。 */
const Toaster = (UI as unknown as Record<string, ComponentType | undefined>)["Toaster"];

const EASE = [0.22, 1, 0.36, 1] as const;

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && t.isContentEditable;
}

function useShellHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        const { open, setOpen } = useCommandPalette.getState();
        setOpen(!open);
      } else if (key === "b" && !isTypingTarget(e.target)) {
        e.preventDefault();
        useSidebar.getState().toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function Shell() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useShellHotkeys();
  useEffect(() => watchViewport(), []);
  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={200}>
        <div className="muster-glow flex h-full overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <ConnectionBar />
            <main ref={mainRef} id="main" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <motion.div key={pathname} className="min-h-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
                <Outlet />
              </motion.div>
            </main>
          </div>
        </div>
        <CommandPalette />
        {Toaster && <Toaster />}
      </TooltipProvider>
    </MotionConfig>
  );
}
