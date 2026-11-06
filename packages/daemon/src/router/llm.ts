// LLM 慢路径（可选）：OpenAI 兼容端点，一次 tool-call（dispatch）完成决策。失败一律抛出，由调用方回退到规则。
import type { Bot, Entry } from "@muster/protocol";
import { makeTitle, type Plan } from "./plan";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** MUSTER_ROUTER_LLM 为真值且三项端点配置齐全时启用。 */
export function readLlmConfig(env: Record<string, string | undefined>): LlmConfig | null {
  const flag = (env.MUSTER_ROUTER_LLM ?? "").trim().toLowerCase();
  if (!flag || ["0", "false", "off", "no"].includes(flag)) return null;
  const baseUrl = env.MUSTER_ROUTER_BASE_URL?.trim();
  const apiKey = env.MUSTER_ROUTER_API_KEY?.trim();
  const model = env.MUSTER_ROUTER_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model };
}

const DISPATCH_TOOL = {
  type: "function",
  function: {
    name: "dispatch",
    description: "把用户的请求分发给合适的 Bot；闲聊或无法分发时 tasks 传空数组，只给出 reply。",
    parameters: {
      type: "object",
      properties: {
        reply: { type: "string", description: "给用户的简短中文回复" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              bot: { type: "string", description: "Bot 名称，必须是花名册中的一个" },
              title: { type: "string", description: "不超过 16 字的任务标题" },
              prompt: { type: "string", description: "交给该 Bot 的完整指令，保留用户原意并补全上下文" },
            },
            required: ["bot", "title", "prompt"],
          },
        },
      },
      required: ["reply", "tasks"],
    },
  },
} as const;

function systemPrompt(bots: Bot[]): string {
  const roster = bots
    .filter((b) => b.kind !== "main")
    .map((b) => `- ${b.name}（${b.engineLabel}）：${b.skills.join("、") || "通用"}`)
    .join("\n");
  return [
    "你是 Pip，一个只做理解、分发、汇报的主 Bot，不执行任何工具。",
    "必须调用 dispatch 工具给出结果。把请求拆成子任务并分给下面的 Bot；用户点名时严格照办。",
    "纯闲聊或无法分发时 tasks 为空，reply 给出简短友好的回复并建议怎么说。",
    `花名册：\n${roster}`,
  ].join("\n");
}

function recentContext(entries: Entry[]): string {
  const lines: string[] = [];
  for (const e of entries.slice(-6)) {
    if (e.kind === "user") lines.push(`用户：${e.text}`);
    else if (e.kind === "bot") lines.push(`Pip：${e.text}`);
  }
  return lines.join("\n");
}

export async function planByLlm(
  cfg: LlmConfig,
  text: string,
  bots: Bot[],
  history: Entry[],
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Plan> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 15_000);
  try {
    const ctx = recentContext(history);
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt(bots) },
          { role: "user", content: ctx ? `最近的对话：\n${ctx}\n\n本次消息：${text}` : text },
        ],
        tools: [DISPATCH_TOOL],
        tool_choice: { type: "function", function: { name: "dispatch" } },
      }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`LLM 路由请求失败：HTTP ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
    };
    const msg = data.choices?.[0]?.message;
    const call = msg?.tool_calls?.find((c) => c.function?.name === "dispatch");
    if (!call?.function?.arguments) {
      const content = msg?.content?.trim();
      if (content) return { reply: content, tasks: [] };
      throw new Error("LLM 路由没有返回 dispatch 调用");
    }
    const args = JSON.parse(call.function.arguments) as { reply?: unknown; tasks?: unknown };
    const crew = bots.filter((b) => b.kind !== "main");
    const tasks = (Array.isArray(args.tasks) ? args.tasks : []).flatMap((raw) => {
      const t = raw as { bot?: unknown; title?: unknown; prompt?: unknown };
      const name = typeof t.bot === "string" ? t.bot.trim().toLowerCase() : "";
      const bot = crew.find((b) => b.name.toLowerCase() === name || b.id === t.bot);
      const prompt = typeof t.prompt === "string" ? t.prompt.trim() : "";
      if (!bot || !prompt) return [];
      const title = makeTitle(typeof t.title === "string" && t.title.trim() ? t.title : prompt);
      return [{ bot, title, prompt }];
    });
    const reply = typeof args.reply === "string" && args.reply.trim() ? args.reply.trim() : tasks.length ? "好的，我来安排一下：" : "";
    if (!tasks.length && !reply) throw new Error("LLM 路由结果为空");
    return { reply, tasks };
  } finally {
    clearTimeout(timer);
  }
}
