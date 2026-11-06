// 工作台的纯函数：快捷键映射、文案、diff 解析、从 entries 汇总数据。无 React 依赖，便于测试。
import type { BotStatus, DiffFile, Entry, Task, ToolItem } from "@muster/protocol";

export type SendMode = "normal" | "steer" | "queue" | "interrupt";

/** 任务是否处于“忙碌”状态（此时输入走 插话 / 排队 / 打断）。 */
export function isBusy(task: Pick<Task, "status"> | undefined): boolean {
  return task?.status === "running" || task?.status === "waiting_approval";
}

export interface KeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** 输入法组字中，Enter 用于确认候选词，不能发送。 */
  isComposing?: boolean;
}

/**
 * 键盘 -> 发送模式；返回 null 表示不是发送快捷键（交给输入框默认行为，如 Shift+Enter 换行）。
 *   忙碌：Enter=插话  Alt+Enter=排队  Ctrl/Cmd+Enter=打断并发送
 *   空闲：Enter / Alt+Enter / Ctrl+Enter 都是普通发送
 */
export function resolveSendMode(e: KeyLike, busy: boolean): SendMode | null {
  if (e.key !== "Enter" || e.isComposing || e.shiftKey) return null;
  if (!busy) return "normal";
  if (e.ctrlKey || e.metaKey) return "interrupt";
  if (e.altKey) return "queue";
  return "steer";
}

/** 插话条目的状态标签。 */
export function steerLabel(e: { mode: "steer" | "queue" | "interrupt"; applied: "pending" | "next_step" | "applied" }): string {
  if (e.mode === "interrupt") return "已打断";
  if (e.applied === "applied") return "已采纳";
  if (e.applied === "next_step") return "插话 · 下一步生效";
  return "排队中";
}

/** “读取了 6 个文件 · 运行了 2 条命令 · 修改了 1 个文件”，为 0 的部分省略。 */
export function toolSummaryText(s: { reads: number; commands: number; edits: number }): string {
  const parts: string[] = [];
  if (s.reads > 0) parts.push(`读取了 ${s.reads} 个文件`);
  if (s.commands > 0) parts.push(`运行了 ${s.commands} 条命令`);
  if (s.edits > 0) parts.push(`修改了 ${s.edits} 个文件`);
  return parts.length ? parts.join(" · ") : "工具活动";
}

/** 任务视角下的头像状态（同一个 Bot 可能同时有多个任务，不能直接用 bot.status）。 */
export function taskAvatarStatus(task: Pick<Task, "status"> | undefined, botStatus?: BotStatus): BotStatus {
  switch (task?.status) {
    case "running":
      return botStatus === "thinking" ? "thinking" : "working";
    case "waiting_approval":
      return "waiting_approval";
    case "done":
      return "done";
    case "failed":
      return "error";
    case "cancelled":
      return "sleeping";
    default:
      return "idle";
  }
}

export function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 12400 -> "12.4K" */
export function formatTokens(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ───────────── unified diff ─────────────

export interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk" | "meta";
  /** add/ctx 用新文件行号，del 用旧文件行号。 */
  no?: number;
  text: string;
}

/** 解析统一 diff（只依赖 @@ 头与首字符，容忍被截断的补丁）。 */
export function parseUnifiedDiff(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      inHunk = true;
      out.push({ type: "hunk", text: line });
    } else if (!inHunk) {
      // 首个 @@ 之前的 diff --git / index / --- / +++ 头
      out.push({ type: "meta", text: line });
    } else if (line.startsWith("\\")) {
      out.push({ type: "meta", text: line });
    } else if (line.startsWith("+")) {
      out.push({ type: "add", no: newNo++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      out.push({ type: "del", no: oldNo++, text: line.slice(1) });
    } else {
      out.push({ type: "ctx", no: newNo, text: line.startsWith(" ") ? line.slice(1) : line });
      oldNo++;
      newNo++;
    }
  }
  return out;
}

// ───────────── 从 entries 汇总 ─────────────

/** 汇总所有 diff entry：同一路径取最新一次。 */
export function collectDiffFiles(entries: Entry[]): DiffFile[] {
  const byPath = new Map<string, DiffFile>();
  for (const e of entries) {
    if (e.kind !== "diff") continue;
    for (const f of e.files) {
      byPath.delete(f.path); // 保持“最近修改的在最后”
      byPath.set(f.path, f);
    }
  }
  return [...byPath.values()];
}

const COMMAND_TOOLS = new Set(["bash", "shell", "sh", "cmd", "command", "exec", "powershell", "terminal"]);

/** 汇总 command 类 tool item（终端页）。 */
export function collectCommands(entries: Entry[]): ToolItem[] {
  const out: ToolItem[] = [];
  for (const e of entries) {
    if (e.kind !== "tool_summary") continue;
    for (const it of e.items) if (COMMAND_TOOLS.has(it.tool.toLowerCase())) out.push(it);
  }
  return out;
}

export function lastTestResult(entries: Entry[]): { passed: number; failed: number } | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.kind === "test_result") return { passed: e.passed, failed: e.failed };
  }
  return undefined;
}

// ───────────── phase 2：工作台 v2 的纯函数 ─────────────

/** 毫秒 -> "42 秒" / "12 分钟" / "1 小时 05 分"。 */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${String(m % 60).padStart(2, "0")} 分`;
}

/** 任务用时：进行中按 now 算，已结束按 finishedAt 算；时间非法返回 undefined。 */
export function taskElapsedMs(task: Pick<Task, "startedAt" | "finishedAt" | "status">, now: number): number | undefined {
  const start = Date.parse(task.startedAt);
  if (Number.isNaN(start)) return undefined;
  const end = task.finishedAt ? Date.parse(task.finishedAt) : now;
  return Number.isNaN(end) ? undefined : Math.max(0, end - start);
}

export function formatUsd(n: number | undefined): string {
  return n === undefined ? "—" : `$${n.toFixed(2)}`;
}

/** "deepseek / deepseek-chat"；没有配置时返回 undefined（界面显示“默认模型”）。 */
export function modelLabel(bot: { model?: { provider: string; modelId: string } } | undefined): string | undefined {
  return bot?.model ? `${bot.model.provider} / ${bot.model.modelId}` : undefined;
}

export function diffStats(files: Pick<DiffFile, "additions" | "deletions">[]): { files: number; additions: number; deletions: number } {
  return { files: files.length, additions: files.reduce((a, f) => a + f.additions, 0), deletions: files.reduce((a, f) => a + f.deletions, 0) };
}

export interface FileTreeNode {
  name: string;
  /** 目录为路径前缀（不含末尾 /），文件为完整路径。 */
  path: string;
  file?: DiffFile;
  children: FileTreeNode[];
}

/** 把文件列表建成目录树：单子目录链折叠为 "a/b/c"，目录在前、文件在后，各自按名字排序。 */
export function buildFileTree(files: DiffFile[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cur = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      let next = cur.children.find((c) => c.path === path && !!c.file === isFile);
      if (!next) {
        next = { name: part, path, children: [], ...(isFile ? { file: f } : {}) };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const finish = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes
      .map((n) => {
        if (n.file) return n;
        let node = { ...n, children: finish(n.children) };
        while (node.children.length === 1 && !node.children[0]!.file) {
          const only = node.children[0]!;
          node = { name: `${node.name}/${only.name}`, path: only.path, children: only.children };
        }
        return node;
      })
      .sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
  return finish(root.children);
}

/** 工具名 -> 图标族（EntryView 用）。 */
export function toolKind(tool: string): "read" | "command" | "edit" | "search" | "web" | "other" {
  const t = tool.toLowerCase();
  if (COMMAND_TOOLS.has(t)) return "command";
  if (["read", "cat", "ls", "list", "view", "open"].includes(t)) return "read";
  if (["edit", "write", "patch", "apply_patch", "create", "replace"].includes(t)) return "edit";
  if (["grep", "search", "find", "glob", "rg"].includes(t)) return "search";
  if (["web", "fetch", "http", "browse"].includes(t)) return "web";
  return "other";
}

/** 时间线节点悬停摘要：一句话说明这一步做了什么。 */
export function entrySummary(e: Entry): string {
  switch (e.kind) {
    case "user":
    case "steer":
    case "bot":
    case "system": {
      const t = e.text.replace(/\s+/g, " ").trim();
      return t.length > 60 ? `${t.slice(0, 60)}…` : t;
    }
    case "tool_summary": return toolSummaryText(e);
    case "diff": return e.files.length ? `修改 ${e.files.map((f) => f.path).slice(0, 3).join("、")}${e.files.length > 3 ? " 等" : ""}` : "代码改动";
    case "test_result": return `${e.passed} 通过 · ${e.failed} 失败`;
    case "approval": return "等待你审批一条操作";
    case "dispatch": return `派发：${e.title}`;
    case "choices": return e.prompt ?? "需要你做选择";
  }
}
