import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CalendarClock, ChevronRight } from "lucide-react";
import { MAIN_BOT_ID, type TriggerRule } from "@muster/protocol";
import { MemberAvatar } from "../common";
import { ContextSection } from "../layout";
import { useHub } from "../../lib/hub";
import { botStatusMeta, compareBots, compareTasks, isActiveTask, taskNeedsYou, taskStatusMeta } from "../../lib/status";
import { clockLabel, nextDailyRun } from "./time";

/** Rows shown per group before "查看全部 N 项". */
const MAX_ROWS = 3;
const AVATAR = 20;

interface RowData {
  key: string;
  to: string;
  lead: ReactNode;
  text: string;
  meta?: string;
  /** Longer explanation, shown as a tooltip only. */
  hint?: string;
}

function Row({ to, lead, text, meta, hint }: Omit<RowData, "key">) {
  return (
    <Link to={to} title={hint ?? text} className="-mx-2 flex h-9 items-center gap-2.5 rounded-control px-2 text-sm transition-colors hover:bg-surface-muted">
      <span className="inline-flex size-5 shrink-0 items-center justify-center">{lead}</span>
      <span className="min-w-0 flex-1 truncate text-fg">{text}</span>
      {meta && <span className="shrink-0 text-xs tabular-nums text-fg-3">{meta}</span>}
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-3" />
    </Link>
  );
}

/** One group: hidden without data; at most MAX_ROWS rows, then "查看全部 N 项" (a link when the list has its own page, else expands in place). */
function Group({ title, rows, moreHref }: { title: string; rows: RowData[]; moreHref?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, MAX_ROWS);
  const more = rows.length > MAX_ROWS;
  const moreCls = "-mx-2 flex h-8 items-center rounded-control px-2 text-xs text-fg-3 transition-colors hover:bg-surface-muted hover:text-fg";
  return (
    <ContextSection title={title} aside={<span className="text-xs tabular-nums text-fg-3">{rows.length}</span>}>
      <div>
        {shown.map(({ key, ...row }) => (
          <Row key={key} {...row} />
        ))}
        {more &&
          (moreHref ? (
            <Link to={moreHref} className={moreCls}>
              查看全部 {rows.length} 项
            </Link>
          ) : (
            <button type="button" className={`${moreCls} w-full cursor-pointer`} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? "收起" : `查看全部 ${rows.length} 项`}
            </button>
          ))}
      </div>
    </ContextSection>
  );
}

/** 需要你：每件事一行 —— 待处理的审批，以及没有审批记录却在等确认的任务。 */
function useNeedsYou(now: number): RowData[] {
  const approvals = useHub((s) => s.model.approvals);
  const tasks = useHub((s) => s.model.tasks);
  const bots = useHub((s) => s.model.bots);
  const rows = useMemo<RowData[]>(() => {
    const pending = Object.values(approvals).filter((a) => a.status === "pending").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const covered = new Set(pending.flatMap((a) => (a.taskId ? [a.taskId] : [])));
    const orphanTasks = Object.values(tasks).filter((t) => taskNeedsYou(t.status) && !covered.has(t.id)).sort(compareTasks);
    return [
      ...pending.map((a) => {
        const bot = bots[a.botId];
        return { key: a.id, to: `/inbox?id=${encodeURIComponent(a.id)}`, lead: bot && <MemberAvatar bot={bot} size={AVATAR} />, text: a.title, meta: clockLabel(a.createdAt, now), hint: a.detail };
      }),
      ...orphanTasks.map((t) => {
        const bot = bots[t.botId];
        return { key: t.id, to: `/task/${t.id}`, lead: bot && <MemberAvatar bot={bot} size={AVATAR} />, text: `${bot?.name ?? "成员"} · ${t.title}`, meta: "等确认", hint: "等你确认后继续" };
      }),
    ];
  }, [approvals, tasks, bots, now]);
  return rows;
}

/** 进行中：排队或执行中的任务；在等审批的任务算在“需要你”里，不重复列出。 */
function useActive(): RowData[] {
  const tasks = useHub((s) => s.model.tasks);
  const approvals = useHub((s) => s.model.approvals);
  const bots = useHub((s) => s.model.bots);
  const rows = useMemo<RowData[]>(() => {
    const waiting = new Set(Object.values(approvals).flatMap((a) => (a.status === "pending" && a.taskId ? [a.taskId] : [])));
    return Object.values(tasks)
      .filter((t) => isActiveTask(t.status) && !waiting.has(t.id))
      .sort(compareTasks)
      .map((t) => {
        const bot = bots[t.botId];
        const text = bot ? `${bot.name} · ${t.title}` : t.title;
        return { key: t.id, to: `/task/${t.id}`, lead: bot && <MemberAvatar bot={bot} size={AVATAR} />, text, meta: taskStatusMeta(t.status).label };
      });
  }, [tasks, approvals, bots]);
  return rows;
}

/** 接下来：已启用的定时触发器，带具体日期。只认“每天固定时刻”的 cron，其余显示表达式。 */
function useUpcoming(now: number): RowData[] {
  const triggers = useHub((s) => s.model.triggers);
  const rows = useMemo<RowData[]>(() => {
    return Object.values(triggers)
      .filter((t): t is TriggerRule => t.source === "cron" && t.enabled)
      .map((t) => {
        const expr = t.params.expr ?? "";
        const next = nextDailyRun(expr, t.params.tz, now);
        return { t, expr, when: next?.label ?? `周期 ${expr}`, order: next?.order ?? Infinity };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ t, expr, when }) => ({ key: t.id, to: "/events", lead: <CalendarClock aria-hidden className="size-4 text-fg-3" />, text: t.label, meta: when, hint: `${t.label} · cron ${expr}` }));
  }, [triggers, now]);
  return rows;
}

function useMembers(): RowData[] {
  const bots = useHub((s) => s.model.bots);
  return useMemo<RowData[]>(
    () =>
      Object.values(bots)
        .filter((b) => b.id !== MAIN_BOT_ID)
        .sort(compareBots)
        .map((b) => ({ key: b.id, to: "/crew", lead: <MemberAvatar bot={b} size={AVATAR} />, text: b.name, meta: botStatusMeta(b.status).label, hint: b.statusDetail ?? b.engineLabel })),
    [bots],
  );
}

/** 主线右栏“此刻”：需要你 / 进行中 / 接下来 / 成员，每组是一行一件事的列表；没有数据的组不显示。 */
export function NowPanel({ now }: { now: number }) {
  const needsYou = useNeedsYou(now);
  const active = useActive();
  const upcoming = useUpcoming(now);
  const members = useMembers();
  if (needsYou.length + active.length + upcoming.length + members.length === 0) return <p className="py-2 text-sm text-fg-3">此刻没有需要关注的事。</p>;
  return (
    <>
      <Group title="需要你" rows={needsYou} moreHref="/inbox" />
      <Group title="进行中" rows={active} />
      <Group title="接下来" rows={upcoming} moreHref="/events" />
      <Group title="成员" rows={members} moreHref="/crew" />
    </>
  );
}
