// 团队页共用的常量与纯函数：颜色/形状、成员类型、工具分组、人设模板、模型选项编码。
import type { Bot, BotColor, DetectedAgent, ModelInfo, ModelRef, NativeToolGroup, PebbleShape, Task } from "@muster/protocol";
import { MAIN_BOT_ID } from "@muster/protocol";

export const COLORS: { value: BotColor; label: string }[] = [
  { value: "cream", label: "奶油" },
  { value: "mint", label: "薄荷" },
  { value: "peach", label: "蜜桃" },
  { value: "sky", label: "天空" },
  { value: "lilac", label: "丁香" },
];
export const SHAPES: { value: PebbleShape; label: string }[] = [
  { value: "round", label: "圆圆" },
  { value: "square", label: "方方" },
  { value: "blob", label: "软软" },
  { value: "egg", label: "蛋蛋" },
  { value: "flat", label: "扁扁" },
];

/** Detected engine -> bot kind accepted by `bot.add`. */
export const ENGINE_META: Record<DetectedAgent["engine"], { kind: "codex" | "claude" | "acp"; label: string; install: string }> = {
  claude: { kind: "claude", label: "Claude", install: "安装 Claude Code（npm i -g @anthropic-ai/claude-code），运行 claude 完成登录后重新检测" },
  codex: { kind: "codex", label: "Codex", install: "安装 Codex CLI（npm i -g @openai/codex），运行 codex login 登录后重新检测" },
  opencode: { kind: "acp", label: "OpenCode", install: "安装 OpenCode（npm i -g opencode-ai），配置好账号后重新检测" },
  other: { kind: "acp", label: "其他 Agent", install: "确认命令已加入 PATH 后重新检测" },
};
const STANDARD_ENGINES: DetectedAgent["engine"][] = ["claude", "codex", "opencode"];

/** 保证 claude / codex / opencode 三个常见引擎总会出现（未检测到的置灰）。 */
export function withStandardAgents(agents: DetectedAgent[]): DetectedAgent[] {
  const missing = STANDARD_ENGINES.filter((e) => !agents.some((a) => a.engine === e)).map((e): DetectedAgent => ({ engine: e, command: e, found: false }));
  return [...agents, ...missing];
}

export const isMainBot = (bot: Pick<Bot, "id" | "kind">): boolean => bot.id === MAIN_BOT_ID || bot.kind === "main";
/** Pip 和原生成员有“模型”概念；外部编程 Agent 的模型由其自身管理。 */
export const hasModel = (bot: Pick<Bot, "kind">): boolean => bot.kind === "native" || bot.kind === "main";

export const TOOL_GROUPS: { value: NativeToolGroup; label: string; desc: string; approval?: boolean }[] = [
  { value: "files", label: "文件读取", desc: "读取、列目录、搜索文件" },
  { value: "edit", label: "修改文件", desc: "写入、编辑文件", approval: true },
  { value: "shell", label: "运行命令", desc: "在本机执行命令", approval: true },
  { value: "web", label: "网页抓取", desc: "访问并读取网页内容" },
];

export interface PersonaTemplate {
  id: string;
  label: string;
  persona: string;
  tools: NativeToolGroup[];
  skills: string[];
}
export const PERSONA_TEMPLATES: PersonaTemplate[] = [
  {
    id: "researcher",
    label: "研究员",
    persona: "你是一名严谨的研究员。先把问题拆成可查证的小问题，再检索资料、交叉验证来源；结论要给出依据和出处，区分事实与推测，信息不足时直说，不要编造。最后用简洁的要点汇总。",
    tools: ["files", "web"],
    skills: ["研究调研", "信息检索"],
  },
  {
    id: "office",
    label: "办公助手",
    persona: "你是贴心的办公助手，擅长整理文档、起草邮件、安排日程与待办。回答简洁、有条理；涉及修改文件时先说明将要改什么，得到确认再动手。",
    tools: ["files", "edit"],
    skills: ["文档处理", "日程管理"],
  },
  {
    id: "reviewer",
    label: "代码审查",
    persona: "你是资深代码审查员。阅读改动时关注正确性、边界条件、安全、可读性与测试覆盖；按严重程度列出问题，给出具体位置和修改建议；不直接改动代码，除非被明确要求。",
    tools: ["files"],
    skills: ["代码审查", "缺陷分析"],
  },
  {
    id: "writer",
    label: "翻译写作",
    persona: "你是专业的翻译与写作助手。翻译时忠实原意、语气自然，保留术语与格式；写作时先确认读者与目的，再给出结构清晰、可直接使用的文稿，并说明关键取舍。",
    tools: ["files"],
    skills: ["翻译", "写作润色"],
  },
];

/** 工具组的展示顺序固定，便于比较。 */
export const sortTools = (t: NativeToolGroup[]): NativeToolGroup[] => TOOL_GROUPS.map((g) => g.value).filter((v) => t.includes(v));
export const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

// ── 模型选项 ──
export const DEFAULT_MODEL_KEY = "__default__";
export const modelKey = (m: ModelRef | undefined): string => (m ? `${m.provider}|${m.modelId}` : DEFAULT_MODEL_KEY);
export function parseModelKey(key: string): ModelRef | undefined {
  if (key === DEFAULT_MODEL_KEY) return undefined;
  const i = key.indexOf("|");
  return { provider: key.slice(0, i), modelId: key.slice(i + 1) };
}
export function modelHint(m: ModelInfo): string {
  const parts: string[] = [];
  if (m.contextWindow) parts.push(m.contextWindow >= 1_000_000 ? `${+(m.contextWindow / 1_000_000).toFixed(1)}M 上下文` : `${Math.round(m.contextWindow / 1000)}K 上下文`);
  if (m.reasoning) parts.push("推理");
  if (m.vision) parts.push("视觉");
  return parts.join(" · ");
}

/** The one-line specialty under a member's name: the tagline, else the label of a native member. */
export function specialty(bot: Pick<Bot, "kind" | "tagline" | "engineLabel">): string | undefined {
  return bot.tagline ?? (bot.kind === "native" ? bot.engineLabel : undefined);
}

/** The small tag next to the specialty: native members show their model, external agents their engine. */
export function modelTag(bot: Pick<Bot, "kind" | "engineLabel" | "model">): string {
  return hasModel(bot) ? (bot.model?.modelId ?? "默认模型") : bot.engineLabel;
}

/** First sentence of the persona; external agents get a plain description of the engine. */
export function intro(bot: Pick<Bot, "kind" | "persona" | "engineLabel">): string {
  if (bot.persona) return bot.persona.split(/(?<=[。！？.!?])\s*/)[0]!.trim();
  return bot.kind === "native" ? "还没有写人设" : `接入本机的 ${bot.engineLabel} 编程 Agent`;
}

/** Most recently started task of a bot, if any. */
export function latestTask(tasks: Task[], botId: string): Task | undefined {
  return tasks.filter((t) => t.botId === botId).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
}

export const pick = <T,>(list: readonly T[], not?: T): T => {
  const pool = list.filter((x) => x !== not);
  return (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length || list.length))]!;
};
