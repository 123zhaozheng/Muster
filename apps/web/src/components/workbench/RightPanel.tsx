// 工作台右栏：改动（文件树 + diff）/ 终端 / 日志 / 概览 四个标签 + 底部测试结果摘要。
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { ChevronRight, CircleCheck, CircleX, FileText, Folder, FolderOpen, GitBranch, Play, TerminalSquare } from "lucide-react";
import type { Bot, Branch, DiffFile, Entry, Task } from "@muster/protocol";
import { AnimatedNumber, Chip, DescriptionList, Empty, EASE, ProgressBar, cn, type ChipTone } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { useNow } from "../../shell/useNow";
import { CopyButton } from "./CopyButton";
import { DiffView } from "./DiffView";
import {
  buildFileTree, collectCommands, collectDiffFiles, diffStats, formatDuration, formatTime, formatTokens, lastTestResult, modelLabel, taskElapsedMs,
  type FileTreeNode,
} from "./logic";
import "./workbench.css";

export type RightTab = "diff" | "terminal" | "log" | "overview";

const SOURCE_LABEL = { user: "你", cron: "定时", github: "GitHub", callback: "回调", device: "设备", system: "系统" } as const;
const SOURCE_DOT = { user: "bg-coral", cron: "bg-sky", github: "bg-ink", callback: "bg-mint", device: "bg-amber", system: "bg-lavender" } as const;
const TASK_STATUS: Record<Task["status"], [string, ChipTone]> = {
  queued: ["排队中", "neutral"],
  running: ["进行中", "mint"],
  waiting_approval: ["等待审批", "amber"],
  done: ["已完成", "mint"],
  failed: ["失败", "danger"],
  cancelled: ["已取消", "neutral"],
};

/* ───────────── 改动 ───────────── */

function TreeNode({ node, depth, selected, onSelect }: { node: FileTreeNode; depth: number; selected: string; onSelect: (p: string) => void }) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: 8 + depth * 14 };
  if (node.file) {
    const on = node.path === selected;
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        aria-current={on || undefined}
        title={node.path}
        style={pad}
        className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[13px] transition-colors", on ? "bg-coral-soft text-coral-deep" : "text-ink hover:bg-canvas-deep")}
      >
        <FileText size={14} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
        <span className="font-mono text-[11px] text-mint-deep">+{node.file.additions}</span>
        <span className="font-mono text-[11px] text-danger-deep">−{node.file.deletions}</span>
      </button>
    );
  }
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={pad} className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-[13px] text-ink-soft transition-colors hover:bg-canvas-deep">
        <ChevronRight size={13} className={cn("shrink-0 transition-transform duration-150", open && "rotate-90")} />
        {open ? <FolderOpen size={14} className="shrink-0 text-amber-deep" /> : <Folder size={14} className="shrink-0 text-amber-deep" />}
        <span className="truncate font-mono">{node.name}</span>
      </button>
      {open && node.children.map((c) => <TreeNode key={c.path + (c.file ? "f" : "d")} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />)}
    </div>
  );
}

function DiffTab({ entries, selectedPath, onSelectPath }: { entries: Entry[]; selectedPath: string | null; onSelectPath: (p: string) => void }) {
  const files = useMemo(() => collectDiffFiles(entries), [entries]);
  const tree = useMemo(() => buildFileTree(files), [files]);
  if (files.length === 0) {
    return <Empty compact title="还没有改动" description="Bot 修改文件后，这里会出现文件树和 diff。" pebble={{ shape: "round", color: "mint", status: "idle" }} />;
  }
  const current: DiffFile = files.find((f) => f.path === selectedPath) ?? files[files.length - 1]!;
  const stats = diffStats(files);
  const total = stats.additions + stats.deletions || 1;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-canvas-deep/60 p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{stats.files} 个文件</span>
          <span className="ml-auto font-mono text-xs text-mint-deep">+{stats.additions}</span>
          <span className="font-mono text-xs text-danger-deep">−{stats.deletions}</span>
        </div>
        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
          <span className="bg-mint transition-[width] duration-500 ease-muster" style={{ width: `${(stats.additions / total) * 100}%` }} />
          <span className="bg-danger transition-[width] duration-500 ease-muster" style={{ width: `${(stats.deletions / total) * 100}%` }} />
        </div>
      </div>
      <div className="space-y-px" role="tree" aria-label="改动文件">
        {tree.map((n) => <TreeNode key={n.path + (n.file ? "f" : "d")} node={n} depth={0} selected={current.path} onSelect={onSelectPath} />)}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <FileText size={15} className="shrink-0 text-ink-soft" />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{current.path}</span>
        <span className="font-mono text-xs text-mint-deep">+{current.additions}</span>
        <span className="font-mono text-xs text-danger-deep">−{current.deletions}</span>
        <CopyButton text={current.patch} label="复制补丁" />
      </div>
      <DiffView patch={current.patch} path={current.path} />
    </div>
  );
}

/* ───────────── 终端 ───────────── */

function TerminalTab({ entries, task }: { entries: Entry[]; task: Task }) {
  const cmds = useMemo(() => collectCommands(entries), [entries]);
  if (cmds.length === 0) {
    return <Empty compact title="还没有运行命令" description="Bot 在沙箱里执行的命令和输出会按块显示在这里。" pebble={{ shape: "square", color: "lilac", status: "idle" }} />;
  }
  const all = cmds.map((c) => `$ ${c.label}${c.output ? `\n${c.output}` : ""}`).join("\n\n");
  return (
    <div className="overflow-hidden rounded-xl bg-[#1f1b18] shadow-lift" data-testid="terminal">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" /><span className="size-2.5 rounded-full bg-[#febc2e]" /><span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 min-w-0 flex-1 truncate font-mono text-[11px] text-[#b8aca2]">{task.cwd ?? "terminal"}</span>
        <CopyButton text={all} label="复制全部终端内容" dark />
      </div>
      <div className="wb-scroll space-y-3 p-3 font-mono text-[12.5px] leading-6 text-[#e8e0d8]">
        {cmds.map((c, i) => (
          <div key={i} className="rounded-lg bg-white/[0.04] p-2.5">
            <div className="flex items-start gap-2">
              <span className="text-mint">$</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{c.label}</span>
              {c.ok === true && <CircleCheck size={14} className="mt-1 shrink-0 text-mint" aria-label="成功" />}
              {c.ok === false && <CircleX size={14} className="mt-1 shrink-0 text-[#ff7a7e]" aria-label="失败" />}
              <CopyButton text={c.label} label="复制命令" dark />
            </div>
            {c.output && <pre className={cn("mt-1 whitespace-pre-wrap break-all pl-4", c.ok === false ? "text-[#ff9a9d]" : "text-[#b8aca2]")}>{c.output}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── 日志 ───────────── */

function LogTab({ task }: { task: Task }) {
  const events = useHub((s) => s.model.events);
  const rows = useMemo(() => {
    const mine = events.filter((e) => e.taskId === task.id).map((e) => ({ id: e.id, ts: e.ts, source: e.source, title: e.title, detail: e.detail }));
    mine.push({ id: "__start", ts: task.startedAt, source: "system", title: "任务开始", detail: task.cwd });
    if (task.finishedAt) mine.push({ id: "__end", ts: task.finishedAt, source: "system", title: `任务${TASK_STATUS[task.status][0]}`, detail: undefined });
    return mine.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  }, [events, task]);
  return (
    <ol className="relative space-y-4 pl-5 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-line" aria-label="事件时间线">
      {rows.map((e) => (
        <li key={e.id} className="relative">
          <span className={cn("absolute -left-5 top-1.5 size-3.5 rounded-full ring-4 ring-surface", SOURCE_DOT[e.source])} />
          <div className="rounded-xl bg-canvas-deep/60 p-3 text-sm">
            <div className="flex items-center gap-2">
              <Chip tone="neutral">{SOURCE_LABEL[e.source]}</Chip>
              <span className="text-xs tabular-nums text-ink-faint">{formatTime(e.ts)}</span>
            </div>
            <div className="mt-1.5">{e.title}</div>
            {e.detail && <div className="mt-0.5 break-all text-xs text-ink-soft">{e.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ───────────── 概览 ───────────── */

function OverviewTab({ task, bot, entries }: { task: Task; bot: Bot | undefined; entries: Entry[] }) {
  const now = useNow(task.finishedAt ? 60_000 : 1000);
  const allBranches = useHub((s) => s.model.branches);
  const mine = useMemo<Branch[]>(() => {
    const ids = new Set(entries.map((e) => e.id));
    return Object.values(allBranches).filter((b) => b.taskId === task.id || ids.has(b.forkEntryId));
  }, [allBranches, entries, task.id]);
  const elapsed = taskElapsedMs(task, now);
  const [statusLabel, statusTone] = TASK_STATUS[task.status];
  const started = new Date(task.startedAt);
  return (
    <div className="space-y-5">
      <section aria-label="任务信息">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-soft">任务信息</h3>
        <DescriptionList
          layout="rows"
          items={[
            { label: "成员", value: bot ? `${bot.name} · ${bot.engineLabel}` : "—" },
            { label: "模型", value: modelLabel(bot) ?? "默认模型", mono: !!bot?.model },
            { label: "状态", value: <Chip tone={statusTone}>{statusLabel}</Chip> },
            ...(task.cwd ? [{ label: "工作目录", value: task.cwd, mono: true, copyable: true }] : []),
            ...(task.branch ? [{ label: "Git 分支", value: task.branch, mono: true, copyable: true }] : []),
            { label: "开始于", value: Number.isNaN(started.getTime()) ? "—" : started.toLocaleString("zh-CN", { hour12: false }) },
            { label: "用时", value: elapsed === undefined ? "—" : formatDuration(elapsed) },
          ]}
        />
      </section>
      <section aria-label="成本">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-soft">成本</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-lavender-soft/60 p-3">
            <div className="text-xs text-ink-soft">Token</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">{task.tokens === undefined ? "—" : <AnimatedNumber value={task.tokens} format={formatTokens} />}</div>
          </div>
          <div className="rounded-xl bg-coral-soft/60 p-3">
            <div className="text-xs text-ink-soft">花费</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">{task.costUsd === undefined ? "—" : <AnimatedNumber value={task.costUsd} decimals={2} prefix="$" />}</div>
          </div>
        </div>
        {task.progress !== undefined && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-ink-soft"><span>进度</span><span className="tabular-nums">{Math.round(task.progress)}%</span></div>
            <ProgressBar value={task.progress} tone="mint" label="任务进度" />
          </div>
        )}
      </section>
      <section aria-label="分支">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-ink-soft">分支</h3>
          <Link to={`/task/${task.id}/branches`} className="text-xs text-coral-deep hover:underline">查看分支树</Link>
        </div>
        {mine.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs leading-relaxed text-ink-faint">还没有分支。悬停对话里的任意一步，点右侧的“从这里分支”，就能换个思路再试一次。</div>
        ) : (
          <ul className="space-y-2">
            {mine.map((b) => (
              <li key={b.id}>
                <Link to={`/task/${b.taskId}`} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-soft transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-card">
                  <GitBranch size={14} className="shrink-0 text-lavender-deep" />
                  <span className="min-w-0 flex-1 truncate">{b.label}</span>
                  {b.adopted && <Chip tone="amber">已采用</Chip>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ───────────── 外框 ───────────── */

export interface RightPanelProps {
  task: Task;
  entries: Entry[];
  tab: RightTab;
  onTab: (t: RightTab) => void;
  selectedPath: string | null;
  onSelectPath: (p: string) => void;
  bot?: Bot;
}

export function RightPanel({ task, entries, tab, onTab, selectedPath, onSelectPath, bot }: RightPanelProps) {
  const tests = useMemo(() => lastTestResult(entries), [entries]);
  const fileCount = useMemo(() => collectDiffFiles(entries).length, [entries]);
  const cmdCount = useMemo(() => collectCommands(entries).length, [entries]);
  const tabs: { value: RightTab; label: string; count?: number; icon: typeof FileText }[] = [
    { value: "diff", label: "改动", count: fileCount, icon: FileText },
    { value: "terminal", label: "终端", count: cmdCount, icon: TerminalSquare },
    { value: "log", label: "日志", icon: Play },
    { value: "overview", label: "概览", icon: GitBranch },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-line px-3" role="tablist" aria-label="右栏">
        {tabs.map((t) => {
          const on = tab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`wb-tab-${t.value}`}
              aria-selected={on}
              aria-controls="wb-tabpanel"
              onClick={() => onTab(t.value)}
              className={cn("relative flex cursor-pointer items-center gap-1.5 px-3 py-3.5 text-[15px] font-medium transition-colors duration-150", on ? "text-coral-deep" : "text-ink-soft hover:text-ink")}
            >
              {t.label}
              {!!t.count && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", on ? "bg-coral-soft text-coral-deep" : "bg-canvas-deep text-ink-soft")}>{t.count}</span>}
              {on && <motion.span layoutId="wb-tab-underline" transition={{ duration: 0.28, ease: EASE }} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-coral" />}
            </button>
          );
        })}
      </div>
      <div key={tab} id="wb-tabpanel" role="tabpanel" aria-labelledby={`wb-tab-${tab}`} className="wb-in wb-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "diff" && <DiffTab entries={entries} selectedPath={selectedPath} onSelectPath={onSelectPath} />}
        {tab === "terminal" && <TerminalTab entries={entries} task={task} />}
        {tab === "log" && <LogTab task={task} />}
        {tab === "overview" && <OverviewTab task={task} bot={bot} entries={entries} />}
      </div>
      {tests && (
        <div data-testid="test-summary" className={cn("m-4 mt-0 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium", tests.failed === 0 ? "bg-mint-soft text-mint-deep" : "bg-danger-soft text-danger-deep")}>
          {tests.failed === 0 ? <CircleCheck size={16} /> : <CircleX size={16} />}
          <span className="tabular-nums">{tests.passed} 通过 · {tests.failed} 失败</span>
        </div>
      )}
    </div>
  );
}
