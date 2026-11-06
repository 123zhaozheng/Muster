// 工单详情右栏：概况 / 方案 / 改动 / 终端 / 日志。方案、改动、终端只在真的有尝试、代码改动、命令时出现，概况和日志始终可看。
// 内容都是紧凑的行（标签 + 一行值），不写段落；进度只看阶段（状态徽标）与真实步骤，不显示估算的百分比。
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, FileText, Folder, FolderOpen, XCircle } from "lucide-react";
import type { Bot, Branch, DiffFile, Entry, Task } from "@muster/protocol";
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger, cn } from "@muster/ui";
import { useHub } from "../../lib/hub";
import { taskStatusMeta } from "../../lib/status";
import { useNow } from "../../shell/useNow";
import { AttemptsTab } from "./Attempts";
import { CopyButton } from "./CopyButton";
import { DiffView } from "./DiffView";
import {
  buildFileTree, collectCommands, collectDiffFiles, diffStats, formatDuration, formatTime, formatTokens, modelLabel, taskElapsedMs,
  type FileTreeNode,
} from "./logic";

export type PanelTab = "overview" | "plans" | "diff" | "terminal" | "log";

const SOURCE_LABEL = { user: "你", cron: "定时", github: "GitHub", callback: "回调", device: "设备", system: "系统" } as const;

/* ───────── 概况 ───────── */

function InfoRow({ label, mono, title, children }: { label: string; mono?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-[13px]">
      <dt className="w-16 shrink-0 text-xs text-fg-3">{label}</dt>
      <dd className={cn("min-w-0 flex-1 truncate text-fg", mono && "font-mono text-xs")} title={title}>{children}</dd>
    </div>
  );
}

function OverviewTab({ task, bot }: { task: Task; bot: Bot | undefined }) {
  const now = useNow(task.finishedAt ? 60_000 : 1000);
  const elapsed = taskElapsedMs(task, now);
  const started = new Date(task.startedAt);
  return (
    <dl aria-label="工单信息">
      <InfoRow label="成员">{bot ? `${bot.name} · ${bot.engineLabel}` : "—"}</InfoRow>
      <InfoRow label="模型" mono={!!bot?.model}>{modelLabel(bot) ?? "默认模型"}</InfoRow>
      {task.cwd && <InfoRow label="工作目录" mono title={task.cwd}>{task.cwd}</InfoRow>}
      {task.branch && <InfoRow label="Git 分支" mono title={task.branch}>{task.branch}</InfoRow>}
      <InfoRow label="开始于">{Number.isNaN(started.getTime()) ? "—" : started.toLocaleString("zh-CN", { hour12: false })}</InfoRow>
      <InfoRow label="用时">{elapsed === undefined ? "—" : formatDuration(elapsed)}</InfoRow>
      {task.tokens !== undefined && <InfoRow label="Token">{formatTokens(task.tokens)}</InfoRow>}
      {task.costUsd !== undefined && <InfoRow label="花费（估）">{`$${task.costUsd.toFixed(2)}`}</InfoRow>}
    </dl>
  );
}

/* ───────── 改动 ───────── */

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
        className={cn("flex w-full cursor-pointer items-center gap-2 rounded-control py-1.5 pr-2 text-left text-[13px]", on ? "bg-accent-surface text-accent" : "text-fg hover:bg-surface-muted")}
      >
        <FileText aria-hidden className="size-3.5 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
        <span className="font-mono text-[11px] text-success">+{node.file.additions}</span>
        <span className="font-mono text-[11px] text-danger">−{node.file.deletions}</span>
      </button>
    );
  }
  const FolderIcon = open ? FolderOpen : Folder;
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={pad} className="flex w-full cursor-pointer items-center gap-1.5 rounded-control py-1.5 pr-2 text-left text-[13px] text-fg-2 hover:bg-surface-muted">
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0", open && "rotate-90")} />
        <FolderIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate font-mono">{node.name}</span>
      </button>
      {open && node.children.map((c) => <TreeNode key={c.path + (c.file ? "f" : "d")} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />)}
    </div>
  );
}

function DiffTab({ files, selectedPath, onSelectPath }: { files: DiffFile[]; selectedPath: string | null; onSelectPath: (p: string) => void }) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const current: DiffFile = files.find((f) => f.path === selectedPath) ?? files[files.length - 1]!;
  const stats = diffStats(files);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{stats.files} 个文件</span>
        <span className="ml-auto font-mono text-xs text-success">+{stats.additions}</span>
        <span className="font-mono text-xs text-danger">−{stats.deletions}</span>
      </div>
      <div role="tree" aria-label="改动文件">
        {tree.map((n) => <TreeNode key={n.path + (n.file ? "f" : "d")} node={n} depth={0} selected={current.path} onSelect={onSelectPath} />)}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={current.path}>{current.path}</span>
        <CopyButton text={current.patch} label="复制补丁" />
      </div>
      <DiffView patch={current.patch} path={current.path} />
    </div>
  );
}

/* ───────── 终端 ───────── */

function TerminalTab({ entries, task }: { entries: Entry[]; task: Task }) {
  const cmds = useMemo(() => collectCommands(entries), [entries]);
  const all = cmds.map((c) => `$ ${c.label}${c.output ? `\n${c.output}` : ""}`).join("\n\n");
  return (
    <div className="space-y-2" data-testid="terminal">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3" title={task.cwd}>{task.cwd ?? "命令输出"}</span>
        <CopyButton text={all} label="复制全部终端内容" />
      </div>
      {cmds.map((c, i) => (
        <div key={i} className="rounded-control bg-surface-muted p-2.5 font-mono text-[12.5px] leading-6">
          <div className="flex items-start gap-2">
            <span className="text-fg-3">$</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-fg">{c.label}</span>
            {c.ok === true && <CheckCircle2 size={14} className="mt-1 shrink-0 text-success" aria-label="成功" />}
            {c.ok === false && <XCircle size={14} className="mt-1 shrink-0 text-danger" aria-label="失败" />}
            <CopyButton text={c.label} label="复制命令" />
          </div>
          {c.output && <pre className={cn("mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all pl-4", c.ok === false ? "text-danger" : "text-fg-2")}>{c.output}</pre>}
        </div>
      ))}
    </div>
  );
}

/* ───────── 日志 ───────── */

function LogTab({ task }: { task: Task }) {
  const events = useHub((s) => s.model.events);
  const rows = useMemo(() => {
    const mine = events.filter((e) => e.taskId === task.id).map((e) => ({ id: e.id, ts: e.ts, source: e.source, title: e.title, detail: e.detail }));
    mine.push({ id: "__start", ts: task.startedAt, source: "system", title: "工单开始", detail: task.cwd });
    if (task.finishedAt) mine.push({ id: "__end", ts: task.finishedAt, source: "system", title: `工单${taskStatusMeta(task.status).label}`, detail: undefined });
    return mine.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  }, [events, task]);
  return (
    <ol aria-label="运行记录">
      {rows.map((e) => (
        <li key={e.id} className="flex min-h-8 items-center gap-2 text-[13px]" title={e.detail}>
          <span className="w-10 shrink-0 text-xs tabular-nums text-fg-3">{formatTime(e.ts)}</span>
          <Badge tone="neutral" size="sm">{SOURCE_LABEL[e.source]}</Badge>
          <span className="min-w-0 flex-1 truncate text-fg">{e.title}</span>
        </li>
      ))}
    </ol>
  );
}

/* ───────── 外框 ───────── */

interface TaskPanelProps {
  task: Task;
  bot?: Bot;
  entries: Entry[];
  /** 方案：家族的根工单与全部尝试（见 useAttempts）。 */
  root: Task;
  attempts: Branch[];
  /** 用户选的标签；不可用（例如工单没有改动）或未选时用默认。 */
  tab: PanelTab | null;
  onTab: (t: PanelTab) => void;
  selectedPath: string | null;
  onSelectPath: (p: string) => void;
}

const LABEL: Record<PanelTab, string> = { overview: "概况", plans: "方案", diff: "改动", terminal: "终端", log: "日志" };

export function TaskPanel({ task, bot, entries, root, attempts, tab, onTab, selectedPath, onSelectPath }: TaskPanelProps) {
  const files = useMemo(() => collectDiffFiles(entries), [entries]);
  const cmdCount = useMemo(() => collectCommands(entries).length, [entries]);
  const count: Partial<Record<PanelTab, number>> = { plans: attempts.length, diff: files.length, terminal: cmdCount };
  const available = (["overview", "plans", "diff", "terminal", "log"] as const).filter((t) => t === "overview" || t === "log" || !!count[t]);
  const active: PanelTab = tab && available.includes(tab) ? tab : count.diff ? "diff" : "overview";
  const body = "mt-0 min-h-0 flex-1 overflow-y-auto px-4 py-3";
  return (
    <Tabs value={active} onValueChange={(v) => onTab(v as PanelTab)} className="flex h-full min-h-0 flex-col">
      <TabsList className="w-full shrink-0 px-4 pt-2" aria-label="产物与记录">
        {available.map((t) => (
          <TabsTrigger key={t} value={t}>
            {LABEL[t]}
            {!!count[t] && <span className="text-xs tabular-nums text-fg-3">{count[t]}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview" className={body}>
        <OverviewTab task={task} bot={bot} />
      </TabsContent>
      <TabsContent value="plans" className={body}>
        {attempts.length > 0 && <AttemptsTab task={task} root={root} attempts={attempts} />}
      </TabsContent>
      <TabsContent value="diff" className={body}>
        {files.length > 0 && <DiffTab files={files} selectedPath={selectedPath} onSelectPath={onSelectPath} />}
      </TabsContent>
      <TabsContent value="terminal" className={body}>
        <TerminalTab entries={entries} task={task} />
      </TabsContent>
      <TabsContent value="log" className={body}>
        <LogTab task={task} />
      </TabsContent>
    </Tabs>
  );
}
