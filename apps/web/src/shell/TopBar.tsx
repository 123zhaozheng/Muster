// OWNER: U2. 顶部条（高 56）：面包屑/页面标题、全局搜索（打开命令面板）、“需要你”铃铛、连接状态点、演示模式标签。
import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import { ChevronRight, Search } from "lucide-react";
import { Chip, Kbd, Tooltip, cn } from "@muster/ui";
import { useHub, type ConnStatus } from "../lib/hub";
import { openCommandPalette } from "./CommandPalette";
import { modLabel } from "./keys";
import { crumbsFor } from "./navigation";
import { NotificationBell } from "./NotificationBell";

const CONN: Record<ConnStatus, { dot: string; tip: string }> = {
  open: { dot: "bg-mint", tip: "已连接守护进程" },
  connecting: { dot: "bg-amber animate-pulse", tip: "正在连接守护进程…" },
  closed: { dot: "bg-danger", tip: "连接已断开，正在自动重连" },
};

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const tasks = useHub((s) => s.model.tasks);
  const crumbs = useMemo(() => crumbsFor(pathname, tasks), [pathname, tasks]);
  return (
    <nav aria-label="面包屑" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[15px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${i}-${c.label}`} className={cn("flex min-w-0 items-center gap-1.5", last && "font-semibold text-ink")}>
              {i > 0 && <ChevronRight size={15} className="shrink-0 text-ink-faint" aria-hidden />}
              {c.to && !last ? (
                <Link to={c.to} className="truncate rounded-md text-ink-soft outline-none transition-colors hover:text-coral-deep focus-visible:ring-2 focus-visible:ring-coral/40">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate" aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function TopBar() {
  const status = useHub((s) => s.status);
  const mock = useHub((s) => s.mock);
  const conn = CONN[status];
  const mod = modLabel();

  return (
    <header data-topbar className="relative z-10 flex h-14 shrink-0 items-center gap-4 border-b border-line/70 bg-white/45 px-5 backdrop-blur-xl md:px-8">
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="搜索"
          aria-keyshortcuts="Control+K Meta+K"
          className="group flex h-10 w-10 items-center gap-2.5 rounded-full border border-line bg-white/70 px-0 text-sm text-ink-faint outline-none transition-all duration-200 hover:border-coral/40 hover:bg-white hover:shadow-card focus-visible:ring-2 focus-visible:ring-coral/40 active:scale-[0.98] max-md:justify-center md:w-[min(34vw,340px)] md:px-4"
        >
          <Search size={17} className="shrink-0 text-ink-soft transition-colors group-hover:text-coral-deep" />
          <span className="hidden flex-1 truncate text-left md:block">搜索页面、成员、任务…</span>
          <span className="hidden items-center gap-1 md:flex">
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        {mock && (
          <Chip tone="lavender" title="数据为本地模拟，未连接守护进程" className="hidden sm:inline-flex">
            演示模式
          </Chip>
        )}
        <NotificationBell />
        <Tooltip content={mock ? `${conn.tip}（演示模式：本地模拟数据）` : conn.tip} side="bottom">
          <span role="img" aria-label={`连接状态：${conn.tip}`} tabIndex={0} className="grid size-8 cursor-default place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-coral/40">
            <span className={cn("size-2.5 rounded-full ring-4 ring-white/70", conn.dot)} />
          </span>
        </Tooltip>
      </div>
    </header>
  );
}
