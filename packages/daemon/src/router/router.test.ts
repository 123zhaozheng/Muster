import { describe, expect, it, vi } from "vitest";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import type { Bot, Entry, Task } from "@muster/protocol";
import { MAIN_THREAD_ID } from "@muster/protocol";
import { createHub } from "../core/hub";
import type { ModelService, Orchestrator, StartTaskArgs } from "../core/contracts";
import { createRouter, makeTitle } from "./index";
import { planByRules } from "./plan";

function setup(opts: { llm?: Parameters<typeof createRouter>[0]["llm"]; fetch?: Parameters<typeof createRouter>[0]["fetch"]; failFor?: string; modelService?: ModelService } = {}) {
  const hub = createHub({ dataDir: "unused" });
  const started: StartTaskArgs[] = [];
  const orchestrator = {
    async startTask(a: StartTaskArgs): Promise<Task> {
      if (opts.failFor === a.botId) throw new Error("worktree 创建失败");
      started.push(a);
      const id = `task-${started.length}`;
      return { id, title: a.title, botId: a.botId, threadId: `thread-${id}`, parentThreadId: a.parentThreadId, status: "running", startedAt: hub.now() };
    },
  } as unknown as Orchestrator;
  const router = createRouter({ hub, orchestrator: () => orchestrator, llm: opts.llm ?? null, ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.modelService ? { modelService: opts.modelService } : {}) });
  const entries = () => hub.model.entries[MAIN_THREAD_ID] ?? [];
  return { hub, router, started, entries };
}

const bots = createHub({ dataDir: "unused" }).model.bots;
const botList = Object.values(bots);

describe("规则分发", () => {
  it("fixtures 里的两件事：两个任务分别给小码和阿克", async () => {
    const { router, started, entries, hub } = setup();
    const id = await router.handleUserMessage("shop-api 里两件事：修支付回调 bug 交给小码，写退款接口交给阿克");
    expect(entries()[0]).toMatchObject({ id, kind: "user" });
    expect(started).toHaveLength(2);
    expect(started[0]).toMatchObject({ botId: "bot-xiaoma", title: "修支付回调 bug", parentThreadId: MAIN_THREAD_ID });
    expect(started[1]).toMatchObject({ botId: "bot-ake", title: "写退款接口" });
    expect(started[0]!.prompt).toContain("shop-api");
    expect(started[0]!.prompt).toContain("修支付回调 bug");
    const kinds = entries().map((e) => e.kind);
    expect(kinds).toEqual(["user", "bot", "dispatch", "dispatch", "choices"]);
    expect(hub.model.bots["bot-pip"]?.status).toBe("idle");
  });

  it("“交给小码修 xx，交给阿克写 yy”（任务在名字之后）", () => {
    const plan = planByRules("交给小码修登录 bug，交给阿克写使用文档", botList);
    expect(plan.tasks.map((t) => [t.bot.name, t.title])).toEqual([["小码", "修登录 bug"], ["阿克", "写使用文档"]]);
  });

  it("“让X…”“X：…”以及“和/、”切分", () => {
    expect(planByRules("让小码重构订单模块；阿克：评审退款方案", botList).tasks.map((t) => [t.bot.name, t.title])).toEqual([
      ["小码", "重构订单模块"],
      ["阿克", "评审退款方案"],
    ]);
    expect(planByRules("修支付回调交给小码和写退款接口交给阿克", botList).tasks.map((t) => [t.bot.name, t.title])).toEqual([
      ["小码", "修支付回调"],
      ["阿克", "写退款接口"],
    ]);
  });

  it("多个名字共享同一任务", () => {
    const plan = planByRules("让小码和阿克一起评审这个方案", botList);
    expect(plan.tasks.map((t) => t.bot.name)).toEqual(["小码", "阿克"]);
    expect(plan.tasks[0]!.title).toBe("一起评审这个方案");
  });

  it("任务在名字前一个片段：“修 bug，交给小码”", () => {
    const plan = planByRules("修支付回调 bug，交给小码", botList);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({ title: "修支付回调 bug" });
    expect(plan.tasks[0]!.bot.name).toBe("小码");
  });

  it("title 不超过 16 字", () => {
    expect([...makeTitle("请把整个支付模块里所有的回调处理逻辑全部重构并补齐单元测试覆盖率")].length).toBeLessThanOrEqual(16);
    const plan = planByRules("交给小码把整个支付模块里所有的回调处理逻辑全部重构并补齐单元测试覆盖率", botList);
    expect([...plan.tasks[0]!.title].length).toBeLessThanOrEqual(16);
    expect(plan.tasks[0]!.prompt).toContain("补齐单元测试覆盖率");
  });

  it("引擎别名 codex / claude", () => {
    const plan = planByRules("让 claude 审查这份设计文档", botList);
    expect(plan.tasks[0]!.bot.name).toBe("阿克");
  });
});

describe("未点名的关键字路由", () => {
  const route = (text: string) => planByRules(text, botList).tasks.map((t) => t.bot.name);
  it("代码类 -> 小码", () => expect(route("帮我修一下登录页的 bug")).toEqual(["小码"]));
  it("分析 / 写作 -> 阿克", () => expect(route("分析一下上周的需求并写个总结")).toEqual(["阿克"]));
  it("调研 / 搜索 -> 小探", () => expect(route("调研一下竞品的定价策略")).toEqual(["小探"]));
  it("文档 / 日程 -> 小文", () => expect(route("整理一份周报文档")).toEqual(["小文"]));
  it("多句分别路由", () => expect(route("修登录 bug，调研竞品定价")).toEqual(["小码", "小探"]));
  it("连续落到同一 Bot 的句子合并", () => {
    const plan = planByRules("修登录 bug，补一个接口测试", botList);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]!.prompt).toContain("补一个接口测试");
  });
  it("回复里说明是自动选的人", () => {
    expect(planByRules("修登录 bug", botList).reply).toContain("没指定人选");
  });
});

describe("闲聊不分发", () => {
  it.each(["你好", "谢谢你", "今天天气怎么样", "你能做什么"])("%s", async (text) => {
    const { router, started, entries } = setup();
    await router.handleUserMessage(text);
    expect(started).toHaveLength(0);
    const kinds = entries().map((e) => e.kind);
    expect(kinds).toEqual(["user", "bot"]);
  });

  it("无法分发时给出建议", async () => {
    const { router, entries } = setup();
    await router.handleUserMessage("随便聊聊");
    const reply = entries()[1];
    expect(reply?.kind === "bot" && reply.text).toContain("交给小码");
  });

  it("只点名没有任务时追问", async () => {
    const { router, started, entries } = setup();
    await router.handleUserMessage("交给小码");
    expect(started).toHaveLength(0);
    expect((entries()[1] as Extract<Entry, { kind: "bot" }>).text).toContain("想让小码做什么");
  });
});

describe("分发过程", () => {
  it("Pip 先 thinking 再回到 idle", async () => {
    const { router, hub } = setup();
    const seen: string[] = [];
    hub.subscribe((p) => {
      if (p.push.kind === "bot.updated" && p.push.bot.id === "bot-pip") seen.push(p.push.bot.status);
    });
    await router.handleUserMessage("交给小码修登录 bug");
    expect(seen).toEqual(["thinking", "idle"]);
  });

  it("单个任务启动失败不影响其他任务", async () => {
    const { router, started, entries } = setup({ failFor: "bot-xiaoma" });
    await router.handleUserMessage("交给小码修登录 bug，交给阿克写退款接口");
    expect(started.map((s) => s.botId)).toEqual(["bot-ake"]);
    const texts = entries().flatMap((e) => (e.kind === "bot" ? [e.text] : []));
    expect(texts.some((t) => t.includes("小码 没能接下") && t.includes("worktree 创建失败"))).toBe(true);
    expect(entries().filter((e) => e.kind === "dispatch")).toHaveLength(1);
  });
});

describe("LLM 慢路径", () => {
  const llm = { baseUrl: "http://llm.test/v1", apiKey: "k", model: "m" };
  const toolReply = (args: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "dispatch", arguments: JSON.stringify(args) } }] } }] }),
  });

  it("未点名且配置了 LLM 时由 LLM 决策", async () => {
    const fetch = vi.fn(async () => toolReply({ reply: "收到，让小探去查。", tasks: [{ bot: "小探", title: "查竞品", prompt: "调研三家竞品的定价" }] }));
    const { router, started, entries } = setup({ llm, fetch });
    await router.handleUserMessage("帮我弄清楚别人怎么收费的");
    expect(fetch).toHaveBeenCalledOnce();
    expect(started[0]).toMatchObject({ botId: "bot-xiaotan", title: "查竞品", prompt: "调研三家竞品的定价" });
    expect((entries()[1] as Extract<Entry, { kind: "bot" }>).text).toBe("收到，让小探去查。");
  });

  it("点名时不调用 LLM", async () => {
    const fetch = vi.fn();
    const { router } = setup({ llm, fetch: fetch as never });
    await router.handleUserMessage("交给小码修登录 bug");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("LLM 失败时回退到关键字规则", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { router, started } = setup({ llm, fetch });
    await router.handleUserMessage("修登录 bug");
    expect(started[0]?.botId).toBe("bot-xiaoma");
  });

  it("LLM 判断为闲聊时只回复", async () => {
    const fetch = vi.fn(async () => toolReply({ reply: "哈喽！", tasks: [] }));
    const { router, started, entries } = setup({ llm, fetch });
    await router.handleUserMessage("嗨嗨");
    expect(started).toHaveLength(0);
    expect((entries()[1] as Extract<Entry, { kind: "bot" }>).text).toBe("哈喽！");
  });
});

/** 用 pi-ai faux provider 搭一个 ModelService；configured=false 时 resolve 返回 undefined。 */
function fauxModelService(responses: FauxResponseStep[], configured = true) {
  const faux = fauxProvider({ tokensPerSecond: 2000 });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const ref = { provider: faux.provider.id, modelId: faux.getModel().id };
  const service: ModelService = {
    handlers: {},
    models: () => models,
    resolve: () => (configured ? ref : undefined),
    settings: () => (configured ? { router: ref } : {}),
    onChange: () => () => {},
  };
  return { faux, service };
}

const call = (name: string, args: Record<string, unknown>) => fauxAssistantMessage(fauxToolCall(name, args as never), { stopReason: "toolUse" });
const botTexts = (entries: Entry[]) => entries.flatMap((e) => (e.kind === "bot" ? [e.text] : []));
const systemTexts = (entries: Entry[]) => entries.flatMap((e) => (e.kind === "system" ? [e.text] : []));

const translator: Bot = {
  id: "bot-lingo", name: "语言通", kind: "native", engineLabel: "内置翻译官", shape: "egg", color: "rose", status: "idle",
  skills: ["日语翻译", "多语种润色"], persona: "你是一位精通日语和英语的翻译，擅长商务信函", costWeekUsd: 0, threadId: "thread-lingo", builtin: false,
};

describe("模型路由（pi-ai faux）", () => {
  it("模型分发到正确的 botId，先流式说一句再落派发卡片", async () => {
    const { service, faux } = fauxModelService([
      fauxAssistantMessage([fauxText("收到，让小探去查。"), fauxToolCall("dispatch", { tasks: [{ botId: "bot-xiaotan", title: "查竞品", prompt: "调研三家竞品的定价" }] })], { stopReason: "toolUse" }),
    ]);
    const { router, started, entries, hub } = setup({ modelService: service });
    const pushes: string[] = [];
    hub.subscribe((p) => pushes.push(p.push.kind));
    await router.handleUserMessage("帮我弄清楚别人怎么收费的");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ botId: "bot-xiaotan", title: "查竞品", prompt: "调研三家竞品的定价", parentThreadId: MAIN_THREAD_ID });
    expect(entries().map((e) => e.kind)).toEqual(["user", "bot", "dispatch", "choices"]);
    const reply = entries()[1] as Extract<Entry, { kind: "bot" }>;
    expect(reply.text).toBe("收到，让小探去查。");
    expect(reply.streaming).toBeUndefined();
    expect(pushes).toContain("entry.delta");
    expect(pushes).toContain("entry.replaced");
    expect(faux.getPendingResponseCount()).toBe(0);
    expect(hub.model.bots["bot-pip"]?.status).toBe("idle");
  });

  it("模型只调用 dispatch 时补默认话术；系统提示含全部成员与最近对话", async () => {
    let prompt = "";
    const { service } = fauxModelService([
      (ctx) => {
        prompt = JSON.stringify(ctx.messages);
        return call("dispatch", { tasks: [{ botId: "bot-xiaoma", title: "修登录", prompt: "修登录页 bug" }, { botId: "bot-ake", title: "写文档", prompt: "写说明" }] });
      },
    ]);
    const { router, started, entries, hub } = setup({ modelService: service });
    hub.commit({ kind: "bot.added", bot: translator });
    await router.handleUserMessage("登录页坏了，顺便补个说明");
    expect(started.map((s) => s.botId)).toEqual(["bot-xiaoma", "bot-ake"]);
    expect(botTexts(entries())).toEqual(["好的，我来安排一下："]);
    for (const needle of ["bot-xiaoma", "bot-ake", "bot-xiaotan", "bot-xiaowen", "bot-lingo", "日语翻译", "精通日语", "只做三件事"]) expect(prompt).toContain(needle);
    expect(prompt).not.toContain("id=bot-pip");
  });

  it("闲聊由模型自然回复（reply 工具，流式）", async () => {
    const { service } = fauxModelService([call("reply", { text: "你好呀，今天想先做点什么？" })]);
    const { router, started, entries, hub } = setup({ modelService: service });
    const deltas: string[] = [];
    hub.subscribe((p) => {
      if (p.push.kind === "entry.delta") deltas.push(p.push.delta);
    });
    await router.handleUserMessage("在忙吗");
    expect(started).toHaveLength(0);
    expect(entries().map((e) => e.kind)).toEqual(["user", "bot"]);
    expect(botTexts(entries())).toEqual(["你好呀，今天想先做点什么？"]);
    expect(deltas.join("")).toBe("你好呀，今天想先做点什么？");
    expect(deltas.length).toBeGreaterThan(1);
    expect(systemTexts(entries())).toEqual([]);
  });

  it("模型直接输出文字也算回复", async () => {
    const { service } = fauxModelService([fauxAssistantMessage("我是 Pip，只负责分发。")]);
    const { router, entries } = setup({ modelService: service });
    await router.handleUserMessage("你是谁");
    expect(botTexts(entries())).toEqual(["我是 Pip，只负责分发。"]);
  });

  it("模型失败时回退规则，并只轻提示一次", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "503 upstream" });
    const { service } = fauxModelService([boom(), boom()]);
    const { router, started, entries } = setup({ modelService: service });
    await router.handleUserMessage("修登录 bug");
    expect(started[0]?.botId).toBe("bot-xiaoma");
    expect(systemTexts(entries())).toHaveLength(1);
    expect(systemTexts(entries())[0]).toContain("暂按规则分发");
    await router.handleUserMessage("调研竞品定价");
    expect(started[1]?.botId).toBe("bot-xiaotan");
    expect(systemTexts(entries())).toHaveLength(1);
  });

  it("模型选了不存在的成员也回退规则", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service } = fauxModelService([call("dispatch", { tasks: [{ botId: "bot-ghost", title: "x", prompt: "xx" }] })]);
    const { router, started } = setup({ modelService: service });
    await router.handleUserMessage("修登录 bug");
    expect(started[0]?.botId).toBe("bot-xiaoma");
  });

  it("未配置模型：按规则分发，system 提示每个会话只出现一次", async () => {
    const { service, faux } = fauxModelService([], false);
    const { router, started, entries } = setup({ modelService: service });
    await router.handleUserMessage("修登录 bug");
    expect(started[0]?.botId).toBe("bot-xiaoma");
    expect(systemTexts(entries())).toEqual(["Pip 还没配置模型，暂按规则分发（设置 → 模型）"]);
    expect(entries().map((e) => e.kind)).toEqual(["user", "system", "bot", "dispatch", "choices"]);
    await router.handleUserMessage("你好");
    await router.handleUserMessage("调研竞品定价");
    expect(systemTexts(entries())).toHaveLength(1);
    expect(started).toHaveLength(2);
    expect(faux.state.callCount).toBe(0);
  });

  it("明确点名走规则快路径，不调模型、不提示", async () => {
    const { service, faux } = fauxModelService([call("reply", { text: "不该被用到" })]);
    const { router, started, entries } = setup({ modelService: service });
    await router.handleUserMessage("交给小码修登录 bug");
    expect(started[0]).toMatchObject({ botId: "bot-xiaoma", title: "修登录 bug" });
    expect(faux.state.callCount).toBe(0);
    expect(faux.getPendingResponseCount()).toBe(1);
    expect(systemTexts(entries())).toEqual([]);
  });

  it("含糊的点名（没有指派词）交给模型判断", async () => {
    const { service, faux } = fauxModelService([call("reply", { text: "小码今天状态不错。" })]);
    const { router, started, entries } = setup({ modelService: service });
    await router.handleUserMessage("小码今天状态怎么样");
    expect(faux.state.callCount).toBe(1);
    expect(started).toHaveLength(0);
    expect(botTexts(entries())).toEqual(["小码今天状态不错。"]);
  });

  it("自建成员 bot.added 后立刻可被点名（规则快路径）", async () => {
    const { service, faux } = fauxModelService([]);
    const { router, started, hub } = setup({ modelService: service });
    hub.commit({ kind: "bot.added", bot: translator });
    await router.handleUserMessage("交给语言通翻译这封日语邮件");
    expect(started[0]).toMatchObject({ botId: "bot-lingo", title: "翻译这封日语邮件" });
    expect(faux.state.callCount).toBe(0);
  });

  it("英文名自建成员有词边界，且被删除后不再参与", async () => {
    const { service } = fauxModelService([]);
    const { router, started, entries, hub } = setup({ modelService: service });
    hub.commit({ kind: "bot.added", bot: { ...translator, id: "bot-lex", name: "Lex", skills: ["法务"], persona: undefined } });
    await router.handleUserMessage("让 Lex 审一下这份合同");
    expect(started[0]?.botId).toBe("bot-lex");
    hub.commit({ kind: "bot.removed", botId: "bot-lex" });
    await router.handleUserMessage("让 Lex 再审一下");
    expect(started).toHaveLength(1);
    expect(entries().at(-1)).toMatchObject({ kind: "bot" });
  });

  it("自建成员可被关键字路由（按技能 / 人设），内置角色不受影响", async () => {
    const { router, started, hub } = setup();
    hub.commit({ kind: "bot.added", bot: translator });
    await router.handleUserMessage("把这段话翻译成日语");
    expect(started[0]?.botId).toBe("bot-lingo");
    await router.handleUserMessage("帮我修一下登录页的 bug");
    expect(started[1]?.botId).toBe("bot-xiaoma");
    await router.handleUserMessage("调研一下竞品的定价策略");
    expect(started[2]?.botId).toBe("bot-xiaotan");
    // 关键字路由对已删除的成员也不再命中
    hub.commit({ kind: "bot.removed", botId: "bot-lingo" });
    const rules = planByRules("把这段话翻译成日语", Object.values(hub.model.bots));
    expect(rules.tasks.map((t) => t.bot.id)).not.toContain("bot-lingo");
  });

  it("被删除的成员不在模型清单里", async () => {
    let prompt = "";
    const { service } = fauxModelService([(ctx) => ((prompt = JSON.stringify(ctx.messages)), call("reply", { text: "好" }))]);
    const { router, hub } = setup({ modelService: service });
    hub.commit({ kind: "bot.added", bot: translator });
    hub.commit({ kind: "bot.removed", botId: "bot-lingo" });
    await router.handleUserMessage("随便问问");
    expect(prompt).not.toContain("bot-lingo");
  });

  it("modelService 未配置时回退 MUSTER_ROUTER_* 的 LLM", async () => {
    const { service } = fauxModelService([], false);
    const fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "dispatch", arguments: JSON.stringify({ reply: "env 路径。", tasks: [] }) } }] } }] }),
    }));
    const { router, entries } = setup({ modelService: service, llm: { baseUrl: "http://llm.test/v1", apiKey: "k", model: "m" }, fetch });
    await router.handleUserMessage("嗨嗨");
    expect(fetch).toHaveBeenCalledOnce();
    expect(botTexts(entries())).toEqual(["env 路径。"]);
    expect(systemTexts(entries())).toEqual([]);
  });
});

describe("onTaskEvent", () => {
  const task = (over: Partial<Task> = {}): Task => ({
    id: "task-1", title: "修支付回调 bug", botId: "bot-xiaoma", threadId: "thread-t1", parentThreadId: MAIN_THREAD_ID, status: "done", startedAt: "2026-11-06T00:00:00.000Z", ...over,
  });
  const lastBot = (entries: () => Entry[]) => {
    const e = entries().at(-1);
    return e?.kind === "bot" ? e.text : "";
  };

  it("done：完成了「标题」+ 简要结果", async () => {
    const { router, hub, entries } = setup();
    const tid = "thread-t1";
    hub.commit({ kind: "entry.appended", entry: { id: "x1", threadId: tid, ts: hub.now(), kind: "diff", botId: "bot-xiaoma", files: [{ path: "a.ts", additions: 1, deletions: 1, patch: "" }] } });
    hub.commit({ kind: "entry.appended", entry: { id: "x2", threadId: tid, ts: hub.now(), kind: "test_result", botId: "bot-xiaoma", passed: 12, failed: 0 } });
    hub.commit({ kind: "entry.appended", entry: { id: "x3", threadId: tid, ts: hub.now(), kind: "bot", botId: "bot-xiaoma", text: "已兼容旧签名。" } });
    await router.onTaskEvent(task(), "done");
    const text = lastBot(entries);
    expect(text).toContain("小码 完成了「修支付回调 bug」");
    expect(text).toContain("12 通过 · 0 失败");
    expect(text).toContain("改动 1 个文件");
    expect(text).toContain("已兼容旧签名。");
  });

  it("failed：说明失败与原因", async () => {
    const { router, hub, entries } = setup();
    hub.commit({ kind: "entry.appended", entry: { id: "x1", threadId: "thread-t1", ts: hub.now(), kind: "system", text: "引擎异常退出" } });
    await router.onTaskEvent(task({ status: "failed" }), "failed");
    expect(lastBot(entries)).toBe("小码 没能完成「修支付回调 bug」\n原因：引擎异常退出");
  });

  it("waiting_approval：提醒审批，同一审批不重复", async () => {
    const { router, hub, entries } = setup();
    hub.commit({ kind: "approval.created", approval: { id: "ap-1", botId: "bot-xiaoma", taskId: "task-1", title: "小码 想运行 pnpm install", risk: "medium", status: "pending", createdAt: hub.now() } });
    await router.onTaskEvent(task({ status: "waiting_approval" }), "waiting_approval");
    expect(lastBot(entries)).toContain("需要你审批：小码 想运行 pnpm install");
    const n = entries().length;
    await router.onTaskEvent(task({ status: "waiting_approval" }), "waiting_approval");
    expect(entries()).toHaveLength(n);
    hub.commit({ kind: "approval.created", approval: { id: "ap-2", botId: "bot-xiaoma", taskId: "task-1", title: "小码 想运行 rm -rf dist", risk: "high", status: "pending", createdAt: hub.now() } });
    await router.onTaskEvent(task({ status: "waiting_approval" }), "waiting_approval");
    expect(entries()).toHaveLength(n + 1);
    expect(lastBot(entries)).toContain("rm -rf dist");
  });

  it("waiting_approval 且审批尚未入库：按任务兜底提醒一次", async () => {
    const { router, entries } = setup();
    await router.onTaskEvent(task({ status: "waiting_approval" }), "waiting_approval");
    await router.onTaskEvent(task({ status: "waiting_approval" }), "waiting_approval");
    expect(entries()).toHaveLength(1);
    expect(lastBot(entries)).toContain("需要你审批");
  });
});
