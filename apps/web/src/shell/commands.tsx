// OWNER: U2. 命令面板的数据层：构建命令 + 过滤（纯函数，便于单测）。
//
// 带查询参数的路由约定（页面开发者请响应）：
//   /crew?new=1           打开“新建成员”对话框
//   /events?new=1         打开“新建触发器”编辑器
//   /settings?tab=models  设置页直接定位到“模型”分区
import type { ReactNode } from "react";
import { BrainCircuit, PanelLeft, Plus, Timer } from "lucide-react";
import { MAIN_BOT_ID, type Bot, type Task, type Thread } from "@muster/protocol";
import { ALL_NAV_ITEMS } from "./navigation";

export type CommandGroup = "动作" | "页面" | "成员" | "任务";
export const GROUP_ORDER: CommandGroup[] = ["动作", "页面", "成员", "任务"];

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
  /** 参与搜索的额外文本（小写）。 */
  keywords: string;
  /** 路由跳转目标（含查询参数）。 */
  to?: string;
  /** 非跳转型动作。 */
  run?: () => void;
  icon?: ReactNode;
  /** 成员命令显示该 Bot 的头像。 */
  bot?: Bot;
}

const TASK_STATUS: Record<Task["status"], string> = {
  queued: "排队中",
  running: "进行中",
  waiting_approval: "等你审批",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export interface CommandSource {
  bots: Record<string, Bot>;
  tasks: Record<string, Task>;
  threads: Record<string, Thread>;
}

export function buildCommands(src: CommandSource, actions: { toggleSidebar: () => void; mod: string }): Command[] {
  const out: Command[] = [
    { id: "act:new-bot", group: "动作", label: "新建成员", hint: "添加一个 Bot", keywords: "new add bot member create 添加 创建 子agent 原生", to: "/crew?new=1", icon: <Plus size={16} /> },
    { id: "act:new-trigger", group: "动作", label: "新建触发器", hint: "定时 / GitHub / 设备", keywords: "new add trigger rule create 添加 创建 定时 规则", to: "/events?new=1", icon: <Timer size={16} /> },
    { id: "act:models", group: "动作", label: "打开设置 · 模型", hint: "配置 Provider 与密钥", keywords: "settings model provider key 设置 模型 密钥 api", to: "/settings?tab=models", icon: <BrainCircuit size={16} /> },
    { id: "act:sidebar", group: "动作", label: "收起 / 展开侧栏", hint: `${actions.mod}+B`, keywords: "sidebar toggle collapse 侧栏 折叠", run: actions.toggleSidebar, icon: <PanelLeft size={16} /> },
  ];

  for (const n of ALL_NAV_ITEMS) out.push({ id: `page:${n.to}`, group: "页面", label: n.label, hint: n.to, keywords: n.keywords, to: n.to, icon: n.icon });

  const tasksByBot = new Map<string, Task>();
  for (const t of Object.values(src.tasks)) {
    const cur = tasksByBot.get(t.botId);
    if (!cur || t.startedAt > cur.startedAt) tasksByBot.set(t.botId, t);
  }
  const bots = Object.values(src.bots).sort((a, b) => (a.id === MAIN_BOT_ID ? -1 : b.id === MAIN_BOT_ID ? 1 : a.name.localeCompare(b.name)));
  for (const b of bots) {
    const latest = tasksByBot.get(b.id);
    out.push({
      id: `bot:${b.id}`,
      group: "成员",
      label: b.name,
      hint: b.engineLabel,
      keywords: `${b.kind} ${b.tagline ?? ""} ${b.skills.join(" ")}`.toLowerCase(),
      to: b.id === MAIN_BOT_ID ? "/" : latest ? `/task/${latest.id}` : "/crew",
      bot: b,
    });
  }

  const byStart = Object.values(src.tasks).sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  for (const t of byStart) {
    const botName = src.bots[t.botId]?.name ?? "";
    out.push({
      id: `task:${t.id}`,
      group: "任务",
      label: t.title,
      hint: `${botName} · ${TASK_STATUS[t.status]}`,
      keywords: `${botName} ${t.branch ?? ""} ${src.threads[t.threadId]?.title ?? ""}`.toLowerCase(),
      to: `/task/${t.id}`,
      bot: src.bots[t.botId],
    });
  }
  return out;
}

const LIMIT_EMPTY: Record<CommandGroup, number> = { 动作: 4, 页面: 11, 成员: 6, 任务: 6 };
const LIMIT_QUERY = 8;

/** 空查询：按分组各取前几项；有查询：每个空格分隔的词都要命中 label/hint/keywords，标题前缀命中优先。 */
export function filterCommands(cmds: Command[], query: string): Command[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = tokens.length === 0 ? LIMIT_EMPTY : null;
  const out: Command[] = [];
  for (const g of GROUP_ORDER) {
    let rows = cmds.filter((c) => c.group === g);
    if (tokens.length > 0) {
      const scored = rows
        .map((c) => ({ c, text: `${c.label} ${c.hint ?? ""} ${c.keywords}`.toLowerCase() }))
        .filter(({ text }) => tokens.every((t) => text.includes(t)))
        .map(({ c }) => ({ c, score: tokens.some((t) => c.label.toLowerCase().startsWith(t)) ? 0 : 1 }));
      scored.sort((a, b) => a.score - b.score);
      rows = scored.map((s) => s.c);
    }
    out.push(...rows.slice(0, limit ? limit[g] : LIMIT_QUERY));
  }
  return out;
}
