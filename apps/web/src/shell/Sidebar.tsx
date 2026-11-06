// Sidebar (docs/12 §2): 224px expanded / 68px rail, brand + search, two nav groups, recent chats, settings + connection line.
import { useMemo } from "react";
import { Link, NavLink } from "react-router";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, RotateCw, Search } from "lucide-react";
import { Badge, CountBadge, IconButton, Kbd, Pebble, Tooltip, cn, useReducedMotion } from "@muster/ui";
import { MAIN_BOT_ID } from "@muster/protocol";
import { MemberAvatar } from "../components/common";
import { useHub, type ConnStatus } from "../lib/hub";
import { retryConnection } from "../lib/retry";
import { openCommandSearch } from "./CommandSearch";
import { modLabel } from "./keys";
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "./navigation";
import { countPending, recentThreads } from "./selectors";
import { useCollapsed, useSidebar } from "./sidebarState";

const RECENT_COLLAPSED = 4;
const RECENT_MAX = 8;

const CONN: Record<ConnStatus, { dot: string; label: (pipName: string) => string }> = {
  open: { dot: "bg-success", label: (n) => `${n} 已连接` },
  connecting: { dot: "bg-warning", label: () => "连接中…" },
  closed: { dot: "bg-danger", label: () => "已断开" },
};

/** Icon micro-interaction classes (hover scale, press, pop when becoming active); none under reduced motion. */
function useIconMotion() {
  const reduced = useReducedMotion();
  return reduced ? undefined : "muster-icon";
}

const linkBase = "relative flex h-10 items-center gap-3 rounded-control px-3 text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40";

function NavEntry({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: number }) {
  const iconMotion = useIconMotion();
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={item.label}
      className={({ isActive }) => cn(linkBase, collapsed && "justify-center px-0", isActive ? "bg-accent-surface font-medium text-accent" : "text-fg-2 hover:bg-surface-muted hover:text-fg")}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center", iconMotion)}>{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!!badge && badge > 0 && (
        <CountBadge count={badge} aria-label={`${badge} 项待处理`} className={collapsed ? "absolute right-1 top-0.5 h-4 min-w-4 px-1 text-[10px]" : "ml-auto"} />
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      <span className="block">{link}</span>
    </Tooltip>
  ) : (
    link
  );
}

function RecentList({ collapsed }: { collapsed: boolean }) {
  const threads = useHub((s) => s.model.threads);
  const bots = useHub((s) => s.model.bots);
  const expanded = useSidebar((s) => s.recentExpanded);
  const toggleRecent = useSidebar((s) => s.toggleRecent);
  const recent = useMemo(() => recentThreads(threads, RECENT_MAX), [threads]);
  const hasMore = recent.length > RECENT_COLLAPSED;
  const shown = expanded ? recent : recent.slice(0, RECENT_COLLAPSED);
  const iconMotion = useIconMotion();

  if (collapsed) {
    return (
      <section aria-label="最近对话" className="flex flex-col items-center gap-2 pt-3">
        {recent.slice(0, RECENT_COLLAPSED).map((t) => (
          <Tooltip key={t.id} content={t.title} side="right">
            <span className="block">
              <NavLink to={t.to} end aria-label={t.title} className="block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                {bots[t.botId] ? <MemberAvatar bot={bots[t.botId]!} size={28} className={iconMotion} /> : <Pebble size={28} status="sleeping" className={iconMotion} />}
              </NavLink>
            </span>
          </Tooltip>
        ))}
      </section>
    );
  }

  return (
    <section aria-label="最近对话" className="flex min-h-0 flex-1 flex-col pt-3">
      <div className="flex items-center justify-between px-3 pb-1 text-xs font-medium text-fg-3">
        <span>最近对话</span>
        {hasMore && (
          <button
            type="button"
            onClick={toggleRecent}
            aria-expanded={expanded}
            aria-label={expanded ? "收起最近对话" : "展开更多最近对话"}
            className="grid size-6 cursor-pointer place-items-center rounded-control outline-none transition-colors hover:bg-surface-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ChevronDown size={14} className={cn("transition-transform duration-150", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {shown.map((t) => (
          <li key={t.id}>
            <NavLink
              to={t.to}
              end
              className={({ isActive }) => cn("flex h-9 items-center gap-2.5 rounded-control px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40", isActive ? "bg-surface-muted text-fg" : "text-fg-2 hover:bg-surface-muted hover:text-fg")}
            >
              {bots[t.botId] ? <MemberAvatar bot={bots[t.botId]!} size={24} className={iconMotion} /> : <Pebble size={24} status="sleeping" className={iconMotion} />}
              <span className="truncate">{t.title}</span>
            </NavLink>
          </li>
        ))}
        {recent.length === 0 && <li className="px-3 py-2 text-caption text-fg-3">还没有对话，去主线跟 Pip 说点什么吧</li>}
      </ul>
    </section>
  );
}

export function Sidebar({ inDrawer }: { inDrawer?: boolean }) {
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const approvals = useHub((s) => s.model.approvals);
  const mock = useHub((s) => s.mock);
  const status = useHub((s) => s.status);
  const railCollapsed = useCollapsed();
  const collapsed = !inDrawer && railCollapsed;
  const toggle = useSidebar((s) => s.toggle);
  const pending = useMemo(() => countPending(approvals), [approvals]);
  const mod = modLabel();
  const conn = CONN[status];
  const connText = conn.label(pip?.name ?? "Pip");
  const reduced = useReducedMotion();
  const connDot = cn(conn.dot, status === "connecting" && !reduced && "relative muster-ping");

  const brand = (
    <Link to="/" aria-label="Muster，回到主线" className="flex items-center gap-2.5 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <span className={cn("inline-flex shrink-0", !reduced && "muster-wiggle")}>
        {pip ? <MemberAvatar bot={{ ...pip, status: "idle" }} size={32} /> : <Pebble size={32} />}
      </span>
      {!collapsed && <span className="text-section font-semibold tracking-tight text-fg">Muster</span>}
    </Link>
  );
  const toggleLabel = collapsed ? "展开侧栏" : "收起侧栏";
  const toggleBtn = (
    <IconButton label={toggleLabel} size="sm" shortcut={`${mod}+B`} onClick={toggle} aria-expanded={!collapsed} aria-keyshortcuts="Control+B Meta+B">
      {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
    </IconButton>
  );

  return (
    <aside
      aria-label="侧栏"
      data-collapsed={collapsed}
      className={cn("flex h-full shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 ease-muster", inDrawer ? "w-full" : collapsed ? "w-[68px]" : "w-[224px]")}
    >
      <div className={cn("flex shrink-0 flex-col gap-3 px-3 pt-4", collapsed && "items-center")}>
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between px-1")}>
          {brand}
          {!inDrawer && toggleBtn}
        </div>
        {collapsed ? (
          <Tooltip content="搜索" side="right">
            <IconButton label="搜索" tooltip={false} variant="secondary" aria-keyshortcuts="Control+K Meta+K" onClick={openCommandSearch}>
              <Search />
            </IconButton>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={openCommandSearch}
            aria-label="搜索"
            aria-keyshortcuts="Control+K Meta+K"
            className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-fg-3 outline-none transition-colors hover:border-fg-3/50 focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Search size={16} className="shrink-0" />
            <span className="flex-1 text-left">搜索</span>
            <Kbd>{mod} K</Kbd>
          </button>
        )}
      </div>

      <nav aria-label="主导航" className="flex shrink-0 flex-col gap-0.5 px-3 pt-4">
        {NAV_GROUPS.map((g, gi) => (
          <div key={g.id} className={cn("flex flex-col gap-0.5", gi > 0 && "mt-3 border-t border-border pt-3")}>
            {!collapsed && g.label && <div className="px-3 pb-1 text-xs font-medium text-fg-3">{g.label}</div>}
            {g.items.map((item) => (
              <NavEntry key={item.to} item={item} collapsed={collapsed} badge={item.to === "/inbox" ? pending : undefined} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col px-3">
        <RecentList collapsed={collapsed} />
      </div>

      <div className="flex shrink-0 flex-col gap-1 border-t border-border p-3">
        <NavEntry item={SETTINGS_ITEM} collapsed={collapsed} />
        {collapsed ? (
          <Tooltip content={connText} side="right">
            <span role="img" aria-label={`连接状态：${connText}`} className="mx-auto grid size-6 place-items-center">
              <span className={cn("size-2 rounded-full", connDot)} />
            </span>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-2 px-3 text-caption text-fg-2" role="status" aria-label={`连接状态：${connText}`}>
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", connDot)} />
            <span className="truncate">{connText}</span>
            {status === "closed" && (
              <button type="button" onClick={retryConnection} className="inline-flex cursor-pointer items-center gap-1 rounded-control font-medium text-accent hover:text-accent-hover">
                <RotateCw size={12} />
                重试
              </button>
            )}
            {mock && (
              <Badge size="sm" className="ml-auto" title="数据为本地模拟，未连接守护进程">
                演示
              </Badge>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
