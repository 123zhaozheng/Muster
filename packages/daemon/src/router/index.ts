// OWNER: B6. Pip: thin main bot. Dispatch only; never runs tools itself.
import type { Bot, Entry, EntryId, Task } from "@muster/protocol";
import { MAIN_BOT_ID, MAIN_THREAD_ID } from "@muster/protocol";
import type { Hub, ModelService, Orchestrator, Router } from "../core/contracts";
import { planByLlm, readLlmConfig, type LlmConfig } from "./llm";
import { decideByModel } from "./model";
import { chitchatReply, hasExplicitName, keywordReply, planByKeywords, planNamed, type Plan, type PlannedTask } from "./plan";

export { makeTitle, planByRules } from "./plan";

export interface RouterOptions {
  hub: Hub;
  orchestrator: () => Orchestrator;
  /** 显式传入 LLM 配置（null 表示禁用）；默认读取 MUSTER_ROUTER_* 环境变量。 */
  llm?: LlmConfig | null;
  /** 测试用：替换 fetch。 */
  fetch?: Parameters<typeof planByLlm>[4];
  /** phase 2（R1 实现）：用户在设置里配置的 Pip 模型；优先于 MUSTER_ROUTER_* 环境变量。 */
  modelService?: ModelService;
}

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, "id" | "threadId" | "ts"> : never) : never;

const MODEL_TIMEOUT_MS = 60_000;
const CHOICES = ["顺便跑测试", "完成后通知我"];

const oneLine = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, " ").trim();
  return [...t].length > max ? [...t].slice(0, max).join("") + "…" : t;
};

function entryPreview(e: NewEntry): string | undefined {
  switch (e.kind) {
    case "user":
    case "bot":
    case "system":
      return e.text;
    case "dispatch":
      return `已派给 ${e.title}`;
    default:
      return undefined;
  }
}

export function createRouter(o: RouterOptions): Router {
  const { hub } = o;
  const llm = o.llm !== undefined ? o.llm : readLlmConfig(process.env);
  /** 已提醒过的审批（同一审批不重复提醒）。 */
  const notifiedApprovals = new Set<string>();

  function append(e: NewEntry): EntryId {
    const id = hub.newId("e");
    hub.commit({ kind: "entry.appended", entry: { ...e, id, threadId: MAIN_THREAD_ID, ts: hub.now() } as Entry });
    const thread = hub.model.threads[MAIN_THREAD_ID];
    const preview = entryPreview(e);
    if (thread && preview) hub.commit({ kind: "thread.updated", thread: { ...thread, updatedAt: hub.now(), lastText: oneLine(preview, 60) } });
    return id;
  }

  const say = (text: string) => append({ kind: "bot", botId: MAIN_BOT_ID, text });

  function setPip(status: Bot["status"], detail?: string) {
    const pip = hub.model.bots[MAIN_BOT_ID];
    if (!pip) return;
    const { statusDetail: _old, ...rest } = pip;
    hub.commit({ kind: "bot.updated", bot: { ...rest, status, ...(detail ? { statusDetail: detail } : {}) } });
  }

  const crew = () => Object.values(hub.model.bots);

  /** 把流式文字落成主线上的一条 Pip 消息（首个增量到达时才创建）。 */
  function makeStreamer() {
    let id: EntryId | undefined;
    let text = "";
    return {
      get spoke() {
        return id !== undefined;
      },
      push(delta: string) {
        if (!delta) return;
        if (!id) id = append({ kind: "bot", botId: MAIN_BOT_ID, text: "", streaming: true });
        text += delta;
        hub.commit({ kind: "entry.delta", threadId: MAIN_THREAD_ID, entryId: id, delta });
      },
      /** 结束流式：用最终文字替换（失败时 final 缺省，保留已收到的部分）。 */
      finish(final?: string) {
        if (!id) return;
        const cur = (hub.model.entries[MAIN_THREAD_ID] ?? []).find((e) => e.id === id);
        if (!cur || cur.kind !== "bot") return;
        const { streaming: _s, ...rest } = cur;
        const finalText = (final ?? text).trim() || text;
        hub.commit({ kind: "entry.replaced", entry: { ...rest, text: finalText } });
        const thread = hub.model.threads[MAIN_THREAD_ID];
        if (thread) hub.commit({ kind: "thread.updated", thread: { ...thread, updatedAt: hub.now(), lastText: oneLine(finalText, 60) } });
      },
    };
  }

  /** Pip 当前该用的模型：自己的 bot.model > 设置里的路由默认；未配置返回 undefined。 */
  function resolveModel() {
    const ms = o.modelService;
    if (!ms) return undefined;
    try {
      const own = hub.model.bots[MAIN_BOT_ID]?.model;
      return ms.resolve(own, "router") ?? (own ? ms.resolve(undefined, "router") : undefined);
    } catch {
      return undefined;
    }
  }

  const hinted = new Set<string>();
  /** 每个会话（路由实例）同一类提示只出现一次。 */
  function hintOnce(kind: "unconfigured" | "failed", text: string) {
    if (hinted.has(kind)) return;
    hinted.add(kind);
    append({ kind: "system", text });
  }

  /**
   * 决策：明确点名（规则快路径，不调模型）> 设置里的模型 > MUSTER_ROUTER_* 环境变量 > 关键字规则 > 闲聊。
   * 返回的 spoke 表示 Pip 的回复已经流式落到主线上，调用方不要再重复发。
   */
  async function decide(text: string, userId: EntryId): Promise<{ plan: Plan; spoke: boolean }> {
    const bots = crew();
    const ms = o.modelService;
    const named = ms ? (hasExplicitName(text, bots) ? planNamed(text, bots) : null) : planNamed(text, bots);
    if (named) return { plan: named, spoke: false };

    const history = hub.model.entries[MAIN_THREAD_ID] ?? [];
    let hint: { kind: "unconfigured" | "failed"; text: string } | undefined;
    const ref = resolveModel();
    const streamer = makeStreamer();
    if (ms && ref) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), MODEL_TIMEOUT_MS);
      try {
        const pip = hub.model.bots[MAIN_BOT_ID];
        const d = await decideByModel({
          models: ms.models(), ref, bots, ...(pip ? { pip } : {}), history, skipEntryId: userId, text,
          onDelta: (x) => streamer.push(x), signal: ctl.signal,
        });
        streamer.finish(d.reply);
        return { plan: d, spoke: streamer.spoke };
      } catch (e) {
        streamer.finish();
        const why = e instanceof Error ? e.message : String(e);
        console.warn("[router] 模型路由失败，改用规则：", why);
        hint = { kind: "failed", text: `Pip 的模型这次没调通（${oneLine(why, 60)}），暂按规则分发（设置 → 模型 里检查一下）` };
      } finally {
        clearTimeout(timer);
      }
    } else if (ms) {
      hint = { kind: "unconfigured", text: "Pip 还没配置模型，暂按规则分发（设置 → 模型）" };
    }

    if (llm) {
      try {
        const plan = await planByLlm(llm, text, bots, history.filter((e) => e.id !== userId), o.fetch);
        if (plan.tasks.length || plan.reply) return { plan, spoke: streamer.spoke };
      } catch (e) {
        console.warn("[router] LLM 路由失败，改用规则：", (e as Error).message);
      }
    }
    if (hint) hintOnce(hint.kind, hint.text);
    const tasks = planByKeywords(text, bots);
    const plan = tasks.length ? { reply: keywordReply(tasks), tasks } : { reply: chitchatReply(text, bots), tasks: [] };
    // 模型已经说了一半又失败：不再重复发一条规则闲聊话术
    return { plan: streamer.spoke && !tasks.length ? { reply: "", tasks: [] } : plan, spoke: streamer.spoke };
  }

  async function dispatch(tasks: PlannedTask[]): Promise<void> {
    // 并行启动，但按计划顺序落 dispatch 卡片
    const results = await Promise.allSettled(
      tasks.map((t) => o.orchestrator().startTask({ botId: t.bot.id, title: t.title, prompt: t.prompt, parentThreadId: MAIN_THREAD_ID })),
    );
    results.forEach((r, i) => {
      const t = tasks[i]!;
      if (r.status === "fulfilled") {
        append({ kind: "dispatch", botId: t.bot.id, taskId: r.value.id, title: r.value.title || t.title });
      } else {
        const why = r.reason instanceof Error ? r.reason.message : String(r.reason);
        say(`${t.bot.name} 没能接下「${t.title}」：${oneLine(why)}`);
      }
    });
  }

  return {
    async handleUserMessage(text) {
      const userId = append({ kind: "user", text });
      setPip("thinking", "正在理解并安排任务");
      try {
        const { plan, spoke } = await decide(text, userId);
        if (plan.reply && !spoke) say(plan.reply);
        if (plan.tasks.length) {
          await dispatch(plan.tasks);
          append({ kind: "choices", options: CHOICES, multi: true });
        }
      } catch (e) {
        say(`我这边出了点问题：${oneLine(e instanceof Error ? e.message : String(e))}。请再试一次。`);
      } finally {
        setPip("idle");
      }
      return userId;
    },

    async onTaskEvent(task: Task, kind) {
      const name = hub.model.bots[task.botId]?.name ?? "子 Bot";
      const thread = hub.model.entries[task.threadId] ?? [];
      if (kind === "done") {
        say([`${name} 完成了「${task.title}」`, ...doneDetails(thread)].join("\n"));
      } else if (kind === "failed") {
        const reason = lastText(thread, "system") ?? lastText(thread, "bot");
        say(`${name} 没能完成「${task.title}」${reason ? `\n原因：${oneLine(reason)}` : ""}`);
      } else {
        const pending = Object.values(hub.model.approvals).filter((a) => a.taskId === task.id && a.status === "pending");
        // 审批可能晚于通知才创建：没有具体审批时按任务兜底提醒一次
        const fresh = pending.length ? pending.filter((a) => !notifiedApprovals.has(a.id)) : [];
        if (pending.length === 0 && !notifiedApprovals.has(`task:${task.id}`)) {
          notifiedApprovals.add(`task:${task.id}`);
          say(`${name} 正在做「${task.title}」，需要你审批。`);
        }
        for (const a of fresh) {
          notifiedApprovals.add(a.id);
          say(`${name} 在「${task.title}」里需要你审批：${a.title}`);
        }
      }
    },
  };
}

function lastText(entries: Entry[], kind: "bot" | "system"): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === kind && e.text.trim()) return e.text;
  }
  return undefined;
}

/** 完成汇报的简要结果：测试 / 改动文件数 / 最后一条回复。 */
function doneDetails(entries: Entry[]): string[] {
  const facts: string[] = [];
  const test = [...entries].reverse().find((e) => e.kind === "test_result");
  if (test?.kind === "test_result") facts.push(`${test.passed} 通过 · ${test.failed} 失败`);
  const files = new Set<string>();
  for (const e of entries) if (e.kind === "diff") for (const f of e.files) files.add(f.path);
  if (files.size) facts.push(`改动 ${files.size} 个文件`);
  const out: string[] = [];
  if (facts.length) out.push(facts.join(" · "));
  const last = lastText(entries, "bot");
  if (last) out.push(oneLine(last));
  return out;
}
