// OWNER: U2. 左侧栏 v2：展开 248 / 收起 72，Ctrl/⌘+B 与底部按钮切换，Logo 回主线，分组导航 + 滑动选中态，
// 最近对话（可折叠），Pip 状态卡、连接状态、演示模式标签。
import { useMemo } from "react";
import { Link, NavLink } from "react-router";
import { motion } from "motion/react";
import { ChevronDown, Clock, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Chip, Kbd, Pebble, STATUS_LABEL, StatusPill, Tooltip, cn } from "@muster/ui";
import { MAIN_BOT_ID, type Bot, type BotStatus } from "@muster/protocol";
import { BotAvatar } from "../components/BotAvatar";
import { relativeTime } from "../lib/format";
import { useHub, type ConnStatus } from "../lib/hub";
import { modLabel } from "./keys";
import { NAV_GROUPS, type NavItem } from "./navigation";
import { countPending, recentThreads } from "./selectors";
import { useCollapsed, useSidebar } from "./sidebarState";
import { useNow } from "./useNow";

/** 状态点颜色：工作=薄荷、思考=薰衣草、等审批=琥珀、出错=红、完成=薄荷、空闲/睡眠=灰。 */
export const STATUS_DOT: Record<BotStatus, string> = {
  working: "bg-mint",
  thinking: "bg-lavender",
  waiting_approval: "bg-amber",
  error: "bg-danger",
  done: "bg-mint",
  idle: "bg-ink-faint/70",
  sleeping: "bg-ink-faint/70",
};

const CONN_TEXT: Record<ConnStatus, { label: string; dot: string }> = {
  open: { label: "已连接", dot: "bg-mint" },
  connecting: { label: "连接中…", dot: "bg-amber animate-pulse" },
  closed: { label: "已断开", dot: "bg-danger" },
};

const linkBase =
  "group relative flex h-10 items-center gap-3 rounded-2xl px-3 text-[14.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-coral/40 active:scale-[0.98]";

function NavEntry({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: number }) {
  const link = (
    <NavLink to={item.to} end={item.end} aria-label={item.label} className={({ isActive }) => cn(linkBase, collapsed && "justify-center px-0", isActive ? "text-coral-deep" : "text-ink-soft hover:bg-canvas-deep/70 hover:text-ink")}>
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span layoutId="muster-nav-active" aria-hidden className="absolute inset-0 rounded-2xl bg-coral-soft" transition={{ type: "spring", stiffness: 420, damping: 34 }}>
              <span className="absolute -left-3 top-2.5 bottom-2.5 w-1 rounded-r-full bg-coral" />
            </motion.span>
          )}
          <span className="relative z-10 grid size-6 shrink-0 place-items-center transition-transform duration-200 group-hover:scale-110">{item.icon}</span>
          {!collapsed && <span className="relative z-10 truncate">{item.label}</span>}
          {!!badge && badge > 0 && (
            <span
              key={badge}
              aria-label={`${badge} 项待处理`}
              className={cn(
                "muster-badge-pop z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-coral px-1.5 text-xs font-semibold tabular-nums text-white",
                collapsed ? "absolute right-1 top-0.5 h-4 min-w-4 px-1 text-[10px] ring-2 ring-white" : "ml-auto",
              )}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {/* NavLink 的 className 是函数，直接做 Radix Slot 的子节点会被字符串化导致样式丢失，所以包一层 span */}
      <span className="block">{link}</span>
    </Tooltip>
  ) : (
    link
  );
}

function BotDot({ bot, size }: { bot: Bot | undefined; size: number }) {
  const status: BotStatus = bot?.status ?? "idle";
  return (
    <span className="relative shrink-0">
      {bot ? <BotAvatar bot={bot} size={size} /> : <Pebble size={size} status="sleeping" />}
      <span
        role="img"
        aria-label={STATUS_LABEL[status]}
        data-status={status}
        className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-white", STATUS_DOT[status])}
      />
    </span>
  );
}

function RecentList({ collapsed }: { collapsed: boolean }) {
  const threads = useHub((s) => s.model.threads);
  const bots = useHub((s) => s.model.bots);
  const recentOpen = useSidebar((s) => s.recentOpen);
  const toggleRecent = useSidebar((s) => s.toggleRecent);
  const now = useNow();
  const recent = useMemo(() => recentThreads(threads), [threads]);

  if (collapsed) {
    return (
      <section aria-label="最近对话" className="mt-1 flex flex-col items-center gap-2 border-t border-line/60 pt-3">
        {recent.slice(0, 4).map((t) => (
          <Tooltip key={t.id} content={t.title} side="right">
            <span className="block">
              <NavLink to={t.to} end aria-label={t.title} className="block rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-coral/40">
                <BotDot bot={bots[t.botId]} size={30} />
              </NavLink>
            </span>
          </Tooltip>
        ))}
      </section>
    );
  }

  return (
    <section aria-label="最近对话" className="mt-2 flex min-h-0 flex-1 flex-col border-t border-line/60 pt-2">
      <button
        type="button"
        onClick={toggleRecent}
        aria-expanded={recentOpen}
        className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-ink-faint outline-none transition-colors hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-coral/40"
      >
        <Clock size={14} />
        最近对话
        <ChevronDown size={14} className={cn("ml-auto transition-transform duration-200", !recentOpen && "-rotate-90")} />
      </button>
      {recentOpen && (
        <ul className="muster-stagger flex min-h-0 flex-col gap-0.5 overflow-y-auto pb-1">
          {recent.map((t) => (
            <li key={t.id}>
              <NavLink
                to={t.to}
                end
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-2xl px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-coral/40",
                    isActive ? "bg-coral-soft/70" : "hover:bg-canvas-deep/70",
                  )
                }
              >
                <BotDot bot={bots[t.botId]} size={30} />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] leading-5 text-ink">{t.title}</span>
                  <span className="block text-xs leading-4 text-ink-faint">{relativeTime(t.updatedAt, now)}</span>
                </span>
              </NavLink>
            </li>
          ))}
          {recent.length === 0 && (
            <li className="flex items-center gap-2.5 rounded-2xl px-3 py-3 text-xs leading-5 text-ink-faint">
              <Pebble size={32} status="sleeping" />
              <span>还没有对话，去主线跟 Pip 说点什么吧</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function Logo({ collapsed, pip }: { collapsed: boolean; pip: Bot | undefined }) {
  return (
    <Link
      to="/"
      aria-label="Muster，回到主线"
      className="group flex items-center gap-2.5 rounded-2xl px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
    >
      <motion.span whileHover={{ rotate: [0, -8, 8, -4, 0], scale: 1.08 }} whileTap={{ scale: 0.9 }} transition={{ duration: 0.5 }} className="grid shrink-0 place-items-center">
        {pip ? <BotAvatar bot={pip} size={38} /> : <Pebble shape="round" color="cream" status="idle" size={38} />}
      </motion.span>
      {!collapsed && <span className="text-xl font-semibold tracking-tight text-ink transition-colors group-hover:text-coral-deep">Muster</span>}
    </Link>
  );
}

export function Sidebar() {
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const approvals = useHub((s) => s.model.approvals);
  const mock = useHub((s) => s.mock);
  const status = useHub((s) => s.status);
  const collapsed = useCollapsed();
  const toggle = useSidebar((s) => s.toggle);
  const pending = useMemo(() => countPending(approvals), [approvals]);
  const conn = CONN_TEXT[status];
  const mod = modLabel();

  const connDot = <span aria-hidden className={cn("size-2 shrink-0 rounded-full", conn.dot)} />;
  const toggleLabel = collapsed ? "展开侧栏" : "收起侧栏";
  const toggleBtn = (
    <button
      type="button"
      onClick={toggle}
      aria-label={toggleLabel}
      aria-expanded={!collapsed}
      aria-keyshortcuts="Control+B Meta+B"
      className={cn(
        "flex h-9 items-center gap-2 rounded-xl text-sm text-ink-soft outline-none transition-colors hover:bg-canvas-deep/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-coral/40 active:scale-[0.97]",
        collapsed ? "w-full justify-center" : "px-3",
      )}
    >
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      {!collapsed && (
        <>
          <span>收起侧栏</span>
          <Kbd className="ml-auto">{mod} B</Kbd>
        </>
      )}
    </button>
  );

  return (
    <aside
      aria-label="侧栏"
      data-collapsed={collapsed}
      className={cn(
        "relative z-20 flex shrink-0 flex-col overflow-hidden border-r border-line/70 bg-white/45 backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        collapsed ? "w-[72px]" : "w-[248px]",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "px-4")}>
        {collapsed ? (
          <Tooltip content="Muster · 回到主线" side="right">
            <span className="inline-flex">
              <Logo collapsed pip={pip} />
            </span>
          </Tooltip>
        ) : (
          <Logo collapsed={false} pip={pip} />
        )}
      </div>

      <nav aria-label="主导航" className="flex flex-col gap-0.5 px-3 pb-2 pt-1">
        {NAV_GROUPS.map((g, gi) => (
          <div key={g.id} className={cn("flex flex-col gap-0.5", gi > 0 && "mt-2 border-t border-line/60 pt-2")}>
            {!collapsed && gi > 0 && <div className="px-3 pb-0.5 pt-1 text-[11px] font-medium tracking-wide text-ink-faint">{g.label}</div>}
            {g.items.map((item) => (
              <NavEntry key={item.to} item={item} collapsed={collapsed} badge={item.to === "/inbox" ? pending : undefined} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col px-3">
        <RecentList collapsed={collapsed} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line/60 p-3">
        {collapsed ? (
          <Tooltip content={`${pip?.name ?? "Pip"} · ${STATUS_LABEL[pip?.status ?? "idle"]}`} side="right">
            <Link to="/" aria-label="Pip 状态" className="mx-auto rounded-full outline-none focus-visible:ring-2 focus-visible:ring-coral/40">
              {pip ? <BotAvatar bot={pip} size={44} /> : <Pebble size={44} title="Pip" />}
            </Link>
          </Tooltip>
        ) : (
          <Link
            to="/"
            className="flex items-center gap-3 rounded-card border border-line bg-white/75 p-3 shadow-card outline-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-float focus-visible:ring-2 focus-visible:ring-coral/40"
          >
            {pip ? <BotAvatar bot={pip} size={48} /> : <Pebble size={48} title="Pip" />}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">你好！我是 {pip?.name ?? "Pip"}</div>
              <div className="mt-1">
                <StatusPill status={pip?.status ?? "idle"} />
              </div>
            </div>
          </Link>
        )}

        {collapsed ? (
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip content={conn.label} side="right">
              <span role="img" aria-label={`连接状态：${conn.label}`} className="grid size-6 place-items-center">
                {connDot}
              </span>
            </Tooltip>
            {mock && (
              <Tooltip content="演示模式：数据为本地模拟，未连接守护进程" side="right">
                <Chip tone="lavender" className="px-1.5 text-[10px]">
                  演示
                </Chip>
              </Tooltip>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-1 text-xs text-ink-soft">
            {connDot}
            <span>{conn.label}</span>
            {mock && (
              <Chip tone="lavender" className="ml-auto" title="数据为本地模拟，未连接守护进程">
                演示模式
              </Chip>
            )}
          </div>
        )}

        {collapsed ? (
          <Tooltip content={`${toggleLabel}（${mod}+B）`} side="right">
            {toggleBtn}
          </Tooltip>
        ) : (
          toggleBtn
        )}
      </div>
    </aside>
  );
}
