// Pip 的模型决策（phase 2）：用 pi-ai 的 Models 流式调用，一次请求里让模型通过 dispatch / reply 工具或直接文字给出结果。
// 失败一律抛出，由调用方回退到规则。
import type { Bot, Entry, EntryId } from "@muster/protocol";
import type { AssistantMessage, Context, Tool } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import { DISPATCH_REPLY, makeTitle, type PlannedTask } from "./plan";

export interface ModelRefLite {
  provider: string;
  modelId: string;
}

export interface ModelDecision {
  /** 最终展示给用户的文字（可能为空，调用方补默认话术）。 */
  reply: string;
  tasks: PlannedTask[];
}

const DISPATCH_TOOL: Tool = {
  name: "dispatch",
  description: "把任务分发给团队成员。可一次拆成多个任务；每个任务交给且只交给一个成员。",
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            botId: { type: "string", description: "成员 id，必须取自成员清单" },
            title: { type: "string", description: "不超过 16 字的任务标题" },
            prompt: { type: "string", description: "交给该成员的完整指令：保留用户原意并补足背景（成员看不到本对话）" },
          },
          required: ["botId", "title", "prompt"],
        },
      },
    },
    required: ["tasks"],
  },
};

const REPLY_TOOL: Tool = {
  name: "reply",
  description: "只回复用户、不分发任务：闲聊、答疑、追问细节、没有合适成员时使用。",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "给用户的简短中文回复" } },
    required: ["text"],
  },
};

const STATUS_LABEL: Record<Bot["status"], string> = {
  idle: "空闲",
  thinking: "思考中（忙）",
  working: "工作中（忙）",
  waiting_approval: "等用户审批（忙）",
  done: "刚完成，空闲",
  error: "出错",
  sleeping: "休眠，可唤醒",
};

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return [...t].length > max ? [...t].slice(0, max).join("") + "…" : t;
};

export function crewOf(bots: Bot[]): Bot[] {
  return bots.filter((b) => b.kind !== "main");
}

function rosterLine(b: Bot): string {
  const parts = [
    `id=${b.id}`,
    `名字=${b.name}`,
    `类型=${b.kind}（${b.engineLabel}）`,
    `擅长=${b.skills.join("、") || "通用"}`,
    `状态=${STATUS_LABEL[b.status]}${b.statusDetail ? `：${clip(b.statusDetail, 30)}` : ""}`,
  ];
  if (b.tagline) parts.push(`简介=${clip(b.tagline, 40)}`);
  if (b.persona) parts.push(`人设=${clip(b.persona, 80)}`);
  return `- ${parts.join("｜")}`;
}

/** 最近主线对话摘要（最多 10 条）：用户、Pip、派发卡片。 */
export function recentSummary(entries: Entry[], bots: Record<string, Bot>, skipId?: EntryId): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.id === skipId) continue;
    if (e.kind === "user") lines.push(`用户：${clip(e.text, 160)}`);
    else if (e.kind === "bot") lines.push(`${bots[e.botId]?.name ?? "Pip"}：${clip(e.text, 160)}`);
    else if (e.kind === "dispatch") lines.push(`（Pip 把「${e.title}」派给了${bots[e.botId]?.name ?? "成员"}）`);
  }
  return lines.slice(-10).join("\n");
}

export function systemPrompt(bots: Bot[], pip: Bot | undefined, recent: string): string {
  const crew = crewOf(bots);
  return [
    "你是 Pip，用户个人 Agent 指挥台里的主 Bot。你只做三件事：理解用户意图、把任务分发给团队成员、闲聊答疑。你自己不执行任何工具，不写代码、不查资料、不改文件，也不要声称自己做了这些。",
    ...(pip?.persona ? [`补充设定：${clip(pip.persona, 300)}`] : []),
    "",
    "怎么做：",
    "- 需要有人动手：调用 dispatch，可以把一句话拆成多个任务。botId 只能取自下面的成员清单；prompt 要写成成员能独立执行的完整指令，因为成员看不到本对话。",
    "- 用户点名时严格照办；没点名就按擅长领域挑最合适的人；成员正忙也可以派，但在回复里提一句。",
    "- 闲聊、提问、信息不足需要追问、没有合适成员：用 reply 工具，或直接用文字回答。简短、自然、中文。",
    "- 调用 dispatch 之前可以先用一句话告诉用户你的安排；不要编造清单以外的成员。",
    "",
    crew.length ? `当前团队成员（共 ${crew.length} 位）：\n${crew.map(rosterLine).join("\n")}` : "当前团队里还没有成员；此时只能用 reply 回复，并建议用户先在「团队」页添加成员。",
    ...(recent ? ["", `最近的主线对话：\n${recent}`] : []),
  ].join("\n");
}

/** 按 id（优先）或名字找成员；已删除 / 不存在的返回 undefined。 */
function findBot(crew: Bot[], key: unknown): Bot | undefined {
  if (typeof key !== "string") return undefined;
  const k = key.trim().toLowerCase();
  return crew.find((b) => b.id.toLowerCase() === k) ?? crew.find((b) => b.name.toLowerCase() === k);
}

const asString = (v: unknown) => (typeof v === "string" ? v : "");

export interface DecideArgs {
  models: Models;
  ref: ModelRefLite;
  bots: Bot[];
  pip?: Bot;
  history: Entry[];
  skipEntryId?: EntryId;
  text: string;
  /** 流式文字（普通文本与 reply 工具的 text 都会走这里）。 */
  onDelta(delta: string): void;
  signal?: AbortSignal;
}

export async function decideByModel(a: DecideArgs): Promise<ModelDecision> {
  const model = a.models.getModel(a.ref.provider, a.ref.modelId);
  if (!model) throw new Error(`找不到模型 ${a.ref.provider}/${a.ref.modelId}`);
  const crew = crewOf(a.bots);
  const botsById = Object.fromEntries(a.bots.map((b) => [b.id, b]));
  const context: Context = {
    systemPrompt: systemPrompt(a.bots, a.pip, recentSummary(a.history, botsById, a.skipEntryId)),
    messages: [{ role: "user", content: a.text, timestamp: Date.now() }],
    tools: [DISPATCH_TOOL, REPLY_TOOL],
  };

  // 逐块把可展示的文字推给调用方；reply 工具的 text 靠 partial 参数增量取出。
  const emittedTool = new Map<number, number>();
  let message: AssistantMessage | undefined;
  const stream = a.models.stream(model, context, { maxTokens: 2000, ...(a.signal ? { signal: a.signal } : {}) });
  for await (const ev of stream) {
    if (ev.type === "text_delta") {
      a.onDelta(ev.delta);
    } else if (ev.type === "toolcall_delta") {
      const block = ev.partial.content[ev.contentIndex];
      if (block?.type === "toolCall" && block.name === "reply") {
        const text = asString(block.arguments.text);
        const seen = emittedTool.get(ev.contentIndex) ?? 0;
        if (text.length > seen) {
          a.onDelta(text.slice(seen));
          emittedTool.set(ev.contentIndex, text.length);
        }
      }
    } else if (ev.type === "done") {
      message = ev.message;
    } else if (ev.type === "error") {
      throw new Error(ev.error.errorMessage || (ev.reason === "aborted" ? "请求超时或被取消" : "模型调用出错"));
    }
  }
  if (!message) throw new Error("模型没有返回结果");

  const texts: string[] = [];
  const tasks: PlannedTask[] = [];
  let dropped = 0;
  for (const block of message.content) {
    if (block.type === "text") {
      if (block.text.trim()) texts.push(block.text.trim());
    } else if (block.type === "toolCall") {
      if (block.argumentsError) throw new Error(`模型的工具参数无效：${clip(block.argumentsError, 80)}`);
      if (block.name === "reply") {
        const t = asString(block.arguments.text).trim();
        if (t) texts.push(t);
      } else if (block.name === "dispatch") {
        const raw = Array.isArray(block.arguments.tasks) ? block.arguments.tasks : [];
        for (const item of raw) {
          const t = (item ?? {}) as Record<string, unknown>;
          const bot = findBot(crew, t.botId ?? t.bot);
          const prompt = asString(t.prompt).trim();
          if (!bot || !prompt) {
            dropped++;
            continue;
          }
          tasks.push({ bot, title: makeTitle(asString(t.title).trim() || prompt), prompt });
        }
      }
    }
  }
  const reply = texts.join("\n");
  if (!tasks.length && !reply) throw new Error(dropped ? "模型选的成员不存在" : "模型没有给出分发或回复");
  return { reply: reply || (tasks.length ? DISPATCH_REPLY : ""), tasks };
}
