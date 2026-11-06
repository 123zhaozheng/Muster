// N1：原生驱动 v2 —— 人设 / 模型 / 工具分组 / 未配置模型提示 / 友好错误。
// 一半用 pi-ai faux provider（看发给模型的 system 与工具），一半用本地假 OpenAI 兼容 SSE 服务（走真实 HTTP 链路）。
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createModels, createProvider, type Models } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import type { Bot, ModelRef } from "@muster/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DriverEvent, DriverSession, ModelService } from "../../core/contracts";
import { createNativeDriver, type NativeDriver } from "./index";
import { NO_MODEL_TEXT } from "./session";
import { describeFailure } from "./translate";
import { fetchPage, htmlToText } from "./tools";

let dir: string;
const drivers: NativeDriver[] = [];
const sessions: DriverSession[] = [];
const servers: Server[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "muster-native-v2-"));
});

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const d of drivers.splice(0)) await d.close();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(undefined)))));
  await rm(dir, { recursive: true, force: true });
});

function collect(session: DriverSession) {
  sessions.push(session);
  const events: DriverEvent[] = [];
  void (async () => {
    for await (const e of session.events) events.push(e);
  })();
  return {
    events,
    async waitFor(pred: (e: DriverEvent) => boolean, from = 0): Promise<DriverEvent> {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const hit = events.slice(from).find(pred);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`等待事件超时，已有：${JSON.stringify(events)}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
}

const kinds = (events: DriverEvent[]) => events.map((e) => e.t);
const textOf = (events: DriverEvent[]) => events.flatMap((e) => (e.t === "text_delta" ? [e.delta] : [])).join("");
const isEnd = (e: DriverEvent) => e.t === "turn_end";

function bot(patch: Partial<Bot> = {}): Bot {
  return {
    id: "bot-x", name: "小研", kind: "native", engineLabel: "内置研究员", shape: "round", color: "mint", status: "idle",
    skills: [], costWeekUsd: 0, threadId: "thr-x", ...patch,
  };
}

// ───────────────────────── faux：人设与工具 ─────────────────────────

type Seen = { system: string; tools: string[] };

/** 从 faux 收到的 transcript 里取 system 内容和首次声明的工具名。 */
function inspectRequest(ctx: { messages: readonly unknown[] }): Seen {
  const sys = ctx.messages.find((m) => (m as { role?: string }).role === "system") as
    | { content?: string; sections?: Record<string, string>; toolsAdded?: { name: string }[] }
    | undefined;
  return {
    system: JSON.stringify([sys?.content, sys?.sections]),
    tools: (sys?.toolsAdded ?? []).map((t) => t.name),
  };
}

async function runFaux(botValue: Bot | undefined) {
  const faux = fauxProvider({ tokensPerSecond: 400 });
  let seen: Seen | undefined;
  const step: FauxResponseStep = (ctx) => {
    seen = inspectRequest(ctx);
    return fauxAssistantMessage("好的");
  };
  faux.setResponses([step]);
  const models = createModels();
  models.setProvider(faux.provider);
  const driver = createNativeDriver({ dataDir: dir, modelSource: { models, model: { provider: faux.provider.id, modelId: faux.getModel().id } } });
  drivers.push(driver);
  const session = await driver.start({ cwd: dir, prompt: "你好", bot: botValue });
  const c = collect(session);
  await c.waitFor(isEnd);
  return seen!;
}

describe("人设与工具分组（faux）", () => {
  it("人设与通用约束都进入 system", async () => {
    const seen = await runFaux(bot({ name: "小研", persona: "你是资深行业研究员，只引用可靠来源。" }));
    expect(seen.system).toContain("你是资深行业研究员，只引用可靠来源。");
    expect(seen.system).toContain("小研");
    for (const rule of ["用中文", "简述你的计划", "审批", "总结"]) expect(seen.system).toContain(rule);
  });

  it("按 tools 分组只暴露对应工具", async () => {
    expect((await runFaux(bot({ tools: ["files"] }))).tools).toEqual(["read", "ls", "grep"]);
  });

  it("edit / shell / web 各自启用", async () => {
    expect((await runFaux(bot({ tools: ["edit"] }))).tools).toEqual(["write", "edit"]);
    expect((await runFaux(bot({ tools: ["shell"] }))).tools).toEqual(["bash"]);
    expect((await runFaux(bot({ tools: ["web"] }))).tools).toEqual(["web_fetch"]);
    expect((await runFaux(bot({ tools: ["files", "web"] }))).tools).toEqual(["read", "ls", "grep", "web_fetch"]);
  });

  it("tools 为空数组则不给任何工具；未指定则用默认（读写+命令，不含联网）", async () => {
    expect((await runFaux(bot({ tools: [] }))).tools).toEqual([]);
    const names = (await runFaux(bot())).tools;
    expect(names).toEqual(expect.arrayContaining(["read", "write", "edit", "bash"]));
    expect(names).not.toContain("web_fetch");
  });

  it("没有 bot（一期调用方式）仍然可用默认工具", async () => {
    expect((await runFaux(undefined)).tools).toEqual(expect.arrayContaining(["read", "bash"]));
  });
});

describe("补充工具 ls / grep / web_fetch", () => {
  function runTools(steps: FauxResponseStep[], b: Bot) {
    const faux = fauxProvider({ tokensPerSecond: 400 });
    faux.setResponses(steps);
    const models = createModels();
    models.setProvider(faux.provider);
    const driver = createNativeDriver({ dataDir: dir, modelSource: { models, model: { provider: faux.provider.id, modelId: faux.getModel().id } } });
    drivers.push(driver);
    return driver.start({ cwd: dir, prompt: "go", bot: b });
  }
  const call = (name: string, args: Record<string, unknown>) => fauxAssistantMessage(fauxToolCall(name, args as Record<string, string>), { stopReason: "toolUse" });

  it("ls 与 grep 在工作目录内工作，且无需审批", async () => {
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "a.txt"), "第一行\nfoo bar\n");
    await writeFile(join(dir, "sub", "b.txt"), "FOO baz\n");
    const session = await runTools([call("ls", {}), call("grep", { pattern: "foo", ignoreCase: true }), fauxAssistantMessage("完成")], bot({ tools: ["files"] }));
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);
    const tools = events.filter((e) => e.t === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ tool: "ls", kind: "read", ok: true });
    expect(tools[0]!.t === "tool" && tools[0]!.output).toContain("sub/");
    expect(tools[0]!.t === "tool" && tools[0]!.output).toContain("a.txt");
    const grep = tools[1]!.t === "tool" ? tools[1]!.output : "";
    expect(grep).toContain("a.txt:2: foo bar");
    expect(grep).toMatch(/sub[\\/]b\.txt:1: FOO baz|sub\/b\.txt:1: FOO baz/);
    expect(events.some((e) => e.t === "approval")).toBe(false);
  });

  it("web_fetch 抓取页面并转成文本", async () => {
    const web = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<html><head><title>测试页</title><style>p{}</style></head><body><h1>标题</h1><p>正文 &amp; 内容</p><script>alert(1)</script></body></html>");
    });
    servers.push(web);
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(web.address() as AddressInfo).port}/`;
    const session = await runTools([call("web_fetch", { url }), fauxAssistantMessage("抓到了")], bot({ tools: ["web"] }));
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);
    const tool = events.find((e) => e.t === "tool");
    expect(tool).toMatchObject({ tool: "web_fetch", ok: true });
    const output = tool?.t === "tool" ? (tool.output ?? "") : "";
    expect(output).toContain("标题：测试页");
    expect(output).toContain("正文 & 内容");
    expect(output).not.toContain("alert");
    expect(events.some((e) => e.t === "approval")).toBe(false);
  });

  it("fetchPage 拒绝非 http(s)、按长度截断、坏地址给出错误", async () => {
    expect((await fetchPage("file:///etc/passwd", undefined)).isError).toBe(true);
    expect((await fetchPage("not a url", undefined)).isError).toBe(true);
    const web = createServer((_req, res) => {
      res.setHeader("content-type", "text/plain");
      res.end("x".repeat(5000));
    });
    servers.push(web);
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
    const ok = await fetchPage(`http://127.0.0.1:${(web.address() as AddressInfo).port}/`, 300);
    expect(ok.isError).toBeUndefined();
    expect(ok.output[0]!.text.length).toBeLessThan(400);
    expect(ok.output[0]!.text).toContain("已截断");
    expect((await fetchPage("http://127.0.0.1:1/", undefined)).isError).toBe(true);
  });

  it("htmlToText 去掉脚本样式并解码实体", () => {
    const text = htmlToText("<title>T</title><style>a{}</style><ul><li>一</li><li>二&nbsp;&#x4e09;</li></ul><script>x()</script>");
    expect(text).toContain("标题：T");
    expect(text).toContain("- 一");
    expect(text).toContain("二 三");
    expect(text).not.toContain("x()");
  });
});

// ───────────────────────── 本地假 OpenAI 兼容服务 ─────────────────────────

interface FakeRequest {
  auth: string | undefined;
  body: { model: string; messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] };
}

async function fakeOpenAI(o: { apiKey?: string; reply?: (req: FakeRequest) => string } = {}) {
  const requests: FakeRequest[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as FakeRequest["body"];
    const request = { auth: req.headers.authorization, body };
    requests.push(request);
    if (o.apiKey && request.auth !== `Bearer ${o.apiKey}`) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }));
      return;
    }
    const reply = (o.reply ?? ((r) => `来自 ${r.body.model} 的回复`))(request);
    res.setHeader("content-type", "text/event-stream");
    const send = (data: unknown) => res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
    const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: body.model };
    send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
    for (const piece of reply.match(/[\s\S]{1,6}/g) ?? []) send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    send({ ...base, choices: [], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } });
    send("[DONE]");
    res.end();
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests };
}

/** 最小的 ModelService：一个 OpenAI 兼容 provider，可随时改 key / 默认模型并触发 onChange。 */
function fakeModelService(init: { baseUrl?: string; apiKey?: string; modelIds?: string[]; native?: ModelRef }) {
  const state = { ...init };
  const listeners = new Set<() => void>();
  let models = createModels();
  const rebuild = () => {
    models = createModels();
    if (!state.baseUrl) return;
    models.setProvider(
      createProvider({
        id: "fake",
        name: "Fake",
        baseUrl: state.baseUrl,
        auth: { apiKey: { name: "FAKE_KEY", resolve: async () => ({ auth: { apiKey: state.apiKey ?? "sk-test" } }) } },
        models: (state.modelIds ?? []).map((id) => ({
          id, name: id, api: "openai-completions" as const, provider: "fake", baseUrl: state.baseUrl!, reasoning: false, input: ["text" as const],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 4096,
        })),
        api: openAICompletionsApi(),
      }),
    );
  };
  rebuild();
  const service: ModelService = {
    handlers: {},
    models: () => models,
    resolve(ref) {
      if (ref && models.getModel(ref.provider, ref.modelId)) return ref;
      return state.native && models.getModel(state.native.provider, state.native.modelId) ? state.native : undefined;
    },
    settings: () => ({ native: state.native }),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    service,
    update(patch: Partial<typeof init>) {
      Object.assign(state, patch);
      rebuild();
      for (const cb of listeners) cb();
    },
  };
}

const ref = (modelId: string): ModelRef => ({ provider: "fake", modelId });

function openDriver(service: ModelService) {
  const driver = createNativeDriver({ dataDir: dir, modelService: service });
  drivers.push(driver);
  return driver;
}

describe("未配置模型", () => {
  const expected = [
    { t: "turn_start", turn: 1 },
    { t: "text_delta", delta: NO_MODEL_TEXT },
    { t: "text_done" },
    { t: "turn_end", status: "failed", error: "no_model" },
  ];

  it("没有任何来源：start 正常返回，给出提示并以 no_model 失败", async () => {
    const driver = createNativeDriver({ dataDir: dir, env: {} });
    drivers.push(driver);
    const session = await driver.start({ cwd: dir, prompt: "你好" });
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);
    expect(events).toEqual(expected);
    expect(NO_MODEL_TEXT).toContain("设置 → 模型");
  });

  it("ModelService 里没有默认模型：同样的提示；之后追加消息仍给提示、轮次递增", async () => {
    const driver = openDriver(fakeModelService({}).service);
    const session = await driver.start({ cwd: dir, prompt: "你好", bot: bot() });
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);
    expect(events).toEqual(expected);
    await session.send("还在吗", "normal");
    await waitFor((e) => e.t === "turn_end", events.length);
    expect(events.slice(4)).toEqual([
      { t: "turn_start", turn: 2 },
      { t: "text_delta", delta: NO_MODEL_TEXT },
      { t: "text_done" },
      { t: "turn_end", status: "failed", error: "no_model" },
    ]);
  });

  it("之后配置了模型，同一个会话的下一条消息就能正常对话", async () => {
    const server = await fakeOpenAI({ reply: () => "配置好了，我在" });
    const fake = fakeModelService({});
    const session = await openDriver(fake.service).start({ cwd: dir, prompt: "你好", bot: bot() });
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);
    expect(events.at(-1)).toMatchObject({ status: "failed", error: "no_model" });

    fake.update({ baseUrl: server.url, modelIds: ["m1"], native: ref("m1") });
    const mark = events.length;
    await session.send("现在呢", "normal");
    await waitFor(isEnd, mark);
    expect(events.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });
    expect(textOf(events.slice(mark))).toBe("配置好了，我在");
    expect(events[mark]).toEqual({ t: "turn_start", turn: 2 });
    expect(server.requests).toHaveLength(1);
  });
});

describe("真实 HTTP 链路（假 OpenAI 服务）", () => {
  it("一轮对话：人设进入请求的 system、按分组发送工具、用量带成本", async () => {
    const server = await fakeOpenAI({ apiKey: "sk-good", reply: () => "你好，我是小研。" });
    const fake = fakeModelService({ baseUrl: server.url, apiKey: "sk-good", modelIds: ["m1"], native: ref("m1") });
    const session = await openDriver(fake.service).start({
      cwd: dir,
      prompt: "你好",
      bot: bot({ persona: "你是严谨的行业研究员PERSONA", tools: ["files", "web"] }),
    });
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);

    expect(kinds(events)).toEqual(expect.arrayContaining(["turn_start", "text_delta", "text_done", "turn_end"]));
    expect(textOf(events)).toBe("你好，我是小研。");
    const end = events.at(-1);
    expect(end).toMatchObject({ t: "turn_end", status: "completed" });
    // 1000 输入 + 500 输出 token，价格 $1 / $2 每百万：1000*1e-6 + 500*2e-6 = 0.002
    expect(end?.t === "turn_end" && end.usage?.tokens).toBe(1500);
    expect(end?.t === "turn_end" && end.usage?.costUsd).toBeCloseTo(0.002, 6);

    const req = server.requests[0]!;
    expect(req.auth).toBe("Bearer sk-good");
    const system = JSON.stringify(req.body.messages.filter((m) => m.role === "system" || m.role === "developer"));
    expect(system).toContain("你是严谨的行业研究员PERSONA");
    expect(system).toContain("用中文");
    expect((req.body.tools ?? []).map((t) => t.function.name)).toEqual(["read", "ls", "grep", "web_fetch"]);
  });

  it("401：以用户能读懂的方式失败", async () => {
    const server = await fakeOpenAI({ apiKey: "sk-good" });
    const fake = fakeModelService({ baseUrl: server.url, apiKey: "sk-wrong", modelIds: ["m1"], native: ref("m1") });
    const session = await openDriver(fake.service).start({ cwd: dir, prompt: "你好", bot: bot() });
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);
    const end = events.at(-1);
    expect(end).toMatchObject({ t: "turn_end", status: "failed" });
    const error = end?.t === "turn_end" ? (end.error ?? "") : "";
    expect(error).toContain("API Key");
    expect(error).toContain("401");
    expect(error).toContain("设置 → 模型");
    expect(error).not.toMatch(/model_error/);
  });

  it("连不上模型服务：网络错误也给出可读提示", { timeout: 20_000 }, async () => {
    const fake = fakeModelService({ baseUrl: "http://127.0.0.1:1/v1", modelIds: ["m1"], native: ref("m1") });
    const session = await openDriver(fake.service).start({ cwd: dir, prompt: "你好", bot: bot() });
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);
    const end = events.at(-1);
    expect(end).toMatchObject({ t: "turn_end", status: "failed" });
    expect(end?.t === "turn_end" && end.error).toMatch(/^模型请求失败/);
  });

  it("Bot 自己指定的模型覆盖默认模型", async () => {
    const server = await fakeOpenAI();
    const fake = fakeModelService({ baseUrl: server.url, modelIds: ["default-m", "special-m"], native: ref("default-m") });
    const driver = openDriver(fake.service);

    const plain = collect(await driver.start({ cwd: dir, prompt: "a", bot: bot() }));
    await plain.waitFor(isEnd);
    expect(textOf(plain.events)).toBe("来自 default-m 的回复");

    const special = collect(await driver.start({ cwd: dir, prompt: "b", bot: bot({ model: ref("special-m") }) }));
    await special.waitFor(isEnd);
    expect(textOf(special.events)).toBe("来自 special-m 的回复");
    expect(server.requests.map((r) => r.body.model)).toEqual(["default-m", "special-m"]);
  });

  it("设置里改了默认模型：已有会话的下一条消息用新模型，Bot 自己指定的不变", async () => {
    const server = await fakeOpenAI();
    const fake = fakeModelService({ baseUrl: server.url, modelIds: ["m-old", "m-new", "m-pinned"], native: ref("m-old") });
    const driver = openDriver(fake.service);
    const follow = await driver.start({ cwd: dir, prompt: "a", bot: bot() });
    const pinned = await driver.start({ cwd: dir, prompt: "a", bot: bot({ model: ref("m-pinned") }) });
    const f = collect(follow);
    const p = collect(pinned);
    await f.waitFor(isEnd);
    await p.waitFor(isEnd);

    fake.update({ native: ref("m-new") });
    const [fm, pm] = [f.events.length, p.events.length];
    await follow.send("b", "normal");
    await pinned.send("b", "normal");
    await f.waitFor(isEnd, fm);
    await p.waitFor(isEnd, pm);
    expect(textOf(f.events)).toBe("来自 m-old 的回复来自 m-new 的回复");
    expect(textOf(p.events)).toBe("来自 m-pinned 的回复来自 m-pinned 的回复");
  });

  it("配置了模型但 key 在对话中途改对了：下一条消息即可成功（无需重启）", async () => {
    const server = await fakeOpenAI({ apiKey: "sk-good" });
    const fake = fakeModelService({ baseUrl: server.url, apiKey: "sk-bad", modelIds: ["m1"], native: ref("m1") });
    const session = await openDriver(fake.service).start({ cwd: dir, prompt: "你好", bot: bot() });
    const { events, waitFor } = collect(session);
    await waitFor(isEnd);
    expect(events.at(-1)).toMatchObject({ status: "failed" });
    fake.update({ apiKey: "sk-good" });
    const mark = events.length;
    await session.send("再试一次", "normal");
    await waitFor(isEnd, mark);
    expect(events.at(-1)).toMatchObject({ status: "completed" });
  });
});

describe("环境变量兼容路径与错误文案", () => {
  it("MUSTER_NATIVE_* 指向本地服务且不带 key 也能跑通", async () => {
    const server = await fakeOpenAI({ reply: () => "环境变量路径可用" });
    const driver = createNativeDriver({ dataDir: dir, env: { MUSTER_NATIVE_MODEL: "env-m", MUSTER_NATIVE_BASE_URL: server.url } });
    drivers.push(driver);
    const { events, waitFor } = collect(await driver.start({ cwd: dir, prompt: "hi" }));
    await waitFor(isEnd);
    expect(events.at(-1)).toMatchObject({ status: "completed" });
    expect(textOf(events)).toBe("环境变量路径可用");
    expect(server.requests[0]!.body.model).toBe("env-m");
  });

  it("describeFailure：常见失败转成中文提示", () => {
    expect(describeFailure({ reason: "no_model" })).toBe("no_model");
    expect(describeFailure({ reason: "model_error", detail: "No API key for provider: x" })).toContain("API Key");
    expect(describeFailure({ reason: "model_error", detail: "429 Too Many Requests" })).toContain("429");
    expect(describeFailure({ reason: "model_error", detail: "503 upstream down" })).toContain("暂时不可用");
    expect(describeFailure({ reason: "model_error", detail: "404 model not found" })).toContain("404");
    expect(describeFailure({ reason: "model_error", detail: "boom" })).toBe("模型请求失败：boom");
    expect(describeFailure({ reason: "turn_limit", detail: "50 turns" })).toContain("上限");
  });
});
