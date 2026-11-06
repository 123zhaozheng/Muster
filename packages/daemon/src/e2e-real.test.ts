/**
 * 真实模型链路端到端（非 fake 模式）：
 * 假 OpenAI 服务（scripts/fake-openai.mjs）+ 真实 startDaemon(fake:false) + ws 客户端。
 * codex / claude 驱动不会被调用；原生成员跑在 pi-durable 上，Pip 用 ModelService 的模型决策。
 * 剧本顺序依赖，用一个 describe 串行执行。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { MAIN_THREAD_ID } from "@muster/protocol";
import type { Bot, Methods, MethodName, ModelProviderConfig, ServerMessage, Task } from "@muster/protocol";
import { applyPush, modelFromSnapshot, type HubModel } from "@muster/protocol/reducer";

// 这些环境变量会让模型服务走「环境变量兜底」，测试要的是用户在界面里配置的路径。
for (const k of Object.keys(process.env)) if (/^MUSTER_(NATIVE|ROUTER)_/.test(k)) delete process.env[k];

const { startDaemon } = await import("./app");
const fakeMod = (await import(pathToFileURL(join(__dirname, "../../../scripts/fake-openai.mjs")).href)) as {
  startFakeOpenAI(o?: { port?: number; apiKey?: string; models?: string[] }): Promise<{
    url: string;
    requests: { auth?: string; body: { model: string; stream?: boolean; tools?: { function?: { name?: string } }[]; messages: { role: string; content: unknown }[] } }[];
    close(): Promise<void>;
  }>;
};

const TOKEN = "e2e-real-token";
const API_KEY = "sk-e2e-secret-key-7f3a9c1d";
type Daemon = Awaited<ReturnType<typeof startDaemon>>;

class TestClient {
  model!: HubModel;
  /** 收到的所有原始 ws 报文（响应与推送），用来断言 key 不泄露。 */
  raw: string[] = [];
  pushes: Extract<ServerMessage, { type: "push" }>[] = [];
  seqGaps: string[] = [];
  private ws!: WebSocket;
  private pending = new Map<string, (m: ServerMessage) => void>();
  private n = 0;
  private buffered: ServerMessage[] = [];
  private ready = false;
  private lastSeq = 0;

  static async connect(port: number): Promise<TestClient> {
    const c = new TestClient();
    await new Promise<void>((resolve, reject) => {
      c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
      c.ws.once("open", () => resolve());
      c.ws.once("error", reject);
    });
    c.ws.on("message", (d) => {
      const s = d.toString();
      c.raw.push(s);
      c.onMessage(JSON.parse(s) as ServerMessage);
    });
    const snap = await c.request("hub.snapshot", {});
    c.model = modelFromSnapshot(snap);
    c.lastSeq = snap.seq;
    c.ready = true;
    for (const m of c.buffered.splice(0)) c.onMessage(m);
    return c;
  }

  private onMessage(m: ServerMessage) {
    if (m.type === "res") return this.pending.get(m.id)?.(m);
    if (!this.ready) return void this.buffered.push(m);
    if (m.seq <= this.lastSeq) return;
    if (m.seq !== this.lastSeq + 1) this.seqGaps.push(`${this.lastSeq} -> ${m.seq}`);
    this.lastSeq = m.seq;
    this.pushes.push(m);
    this.model = { ...applyPush(this.model, m.push), seq: m.seq };
  }

  request<M extends MethodName>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]> {
    const id = `r${++this.n}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => {
        this.pending.delete(id);
        if (m.type !== "res") return;
        if (m.ok) resolve(m.result as Methods[M]["result"]);
        else reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
      });
      this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  async waitFor<T>(what: string, pick: (m: HubModel) => T | undefined | false, timeoutMs = 30000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = pick(this.model);
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时: ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  close() {
    this.ws.terminate();
  }
}

const isFinished = (t: Task | undefined) => !!t && (t.status === "done" || t.status === "failed" || t.status === "cancelled");

/** 递归读 dataDir 下所有文件（跳过 credentials.json），找 key。 */
function filesContaining(dir: string, needle: string, skip: (p: string) => boolean): string[] {
  const hits: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) hits.push(...filesContaining(p, needle, skip));
    else if (!skip(p) && st.size < 20_000_000) {
      try {
        if (readFileSync(p, "latin1").includes(needle) || readFileSync(p, "utf8").includes(needle)) hits.push(p);
      } catch {
        /* 被占用的文件跳过 */
      }
    }
  }
  return hits;
}

describe("e2e: 真实模型链路（假 OpenAI 服务，非 fake 模式）", () => {
  let dataDir: string;
  let fake: Awaited<ReturnType<typeof fakeMod.startFakeOpenAI>>;
  let daemon: Daemon | undefined;
  let c: TestClient;

  let provider: ModelProviderConfig;
  let member: Bot; // 保留到重启后
  let temp: Bot; // 随后被删除

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "muster-e2e-real-"));
    fake = await fakeMod.startFakeOpenAI({ port: 0, apiKey: API_KEY, models: ["fake-chat", "fake-2"] });
    daemon = await startDaemon({ dataDir, port: 0, token: TOKEN, fake: false });
    c = await TestClient.connect(daemon.port);
  }, 60000);

  afterAll(async () => {
    c?.close();
    await daemon?.stop();
    await fake?.close();
    for (let i = 0; i < 8; i++) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  });

  /** 记录请求数，方便按需只看之后的新请求。 */
  const mark = () => fake.requests.length;
  const nativeReqs = (since: number) =>
    fake.requests.slice(since).filter((r) => r.body.tools?.some((t) => t.function?.name === "read"));
  const routerReqs = (since: number) =>
    fake.requests.slice(since).filter((r) => r.body.tools?.some((t) => t.function?.name === "dispatch"));

  async function untilFinished(taskId: string, timeoutMs = 45000) {
    const t0 = Date.now();
    while (!isFinished(c.model.tasks[taskId])) {
      for (const ap of Object.values(c.model.approvals)) {
        if (ap.status === "pending" && !ap.unattended) await c.request("approval.resolve", { approvalId: ap.id, decision: "allow" });
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`任务未结束: ${taskId} ${c.model.tasks[taskId]?.status}`);
      await new Promise((r) => setTimeout(r, 40));
    }
    return c.model.tasks[taskId]!;
  }
  const tasksOf = (botId: string) => Object.values(c.model.tasks).filter((t) => t.botId === botId);
  const entriesOf = (threadId: string) => c.model.entries[threadId] ?? [];

  it("1. model.catalog 带分组，国内排最前", async () => {
    const { providers } = await c.request("model.catalog", {});
    expect(providers.length).toBeGreaterThan(5);
    const groups = providers.map((p) => p.group);
    expect(groups[0]).toBe("国内");
    expect(new Set(groups)).toEqual(expect.objectContaining(new Set(["国内", "国际"])));
    expect(providers.find((p) => p.id === "deepseek")).toBeTruthy();
  });

  it("2. providerUpsert（openai-compatible，指向假服务）-> model.test 成功", async () => {
    const r = await c.request("model.providerUpsert", {
      provider: { kind: "openai-compatible", name: "假 OpenAI", baseUrl: fake.url, modelIds: ["fake-chat", "fake-2"], enabled: true },
      apiKey: API_KEY,
    });
    provider = r.provider;
    expect(provider.id).toBeTruthy();
    expect(provider.hasApiKey).toBe(true);
    expect(provider).not.toHaveProperty("apiKey");

    const list = await c.request("model.list", {});
    expect(list.models.map((m) => m.id)).toEqual(expect.arrayContaining(["fake-chat", "fake-2"]));

    const t = await c.request("model.test", { ref: { provider: provider.id, modelId: "fake-chat" } });
    expect(t.ok).toBe(true);
    expect(t.reply).toMatch(/OK/);
    // 假服务确实收到了带 Bearer key 的请求
    expect(fake.requests.at(-1)?.auth).toBe(`Bearer ${API_KEY}`);
  });

  it("3. settingsSet 设 router 与 native 默认；snapshot 同步；key 不泄露", async () => {
    const ref = { provider: provider.id, modelId: "fake-chat" };
    const r = await c.request("model.settingsSet", { settings: { router: ref, native: ref } });
    expect(r.settings).toEqual({ router: ref, native: ref });
    await c.waitFor("models.changed 生效", (m) => m.modelSettings.router?.modelId === "fake-chat" && m.modelSettings.native?.modelId === "fake-chat");

    const snap = await c.request("hub.snapshot", {});
    expect(snap.modelSettings).toEqual({ router: ref, native: ref });
    const prov = await c.request("model.providers", {});
    expect(prov.providers.find((p) => p.id === provider.id)?.hasApiKey).toBe(true);

    // 到目前为止收到的所有报文都不含 key
    expect(c.raw.filter((s) => s.includes(API_KEY))).toEqual([]);
    expect(JSON.stringify(snap)).not.toContain(API_KEY);
    // 磁盘上也只有 credentials.json 含 key
    const credFile = join(dataDir, "credentials.json");
    expect(readFileSync(credFile, "utf8")).toContain(API_KEY);
    expect(filesContaining(dataDir, API_KEY, (p) => p === credFile)).toEqual([]);
  });

  it("4. bot.add 原生成员（persona、tools:['files']）", async () => {
    const r = await c.request("bot.add", {
      name: "研究员小林",
      kind: "native",
      persona: "你是严谨的研究员，先列要点再给结论。",
      tools: ["files"],
      skills: ["调研", "研究"],
      model: { provider: provider.id, modelId: "fake-chat" },
    });
    member = r.bot;
    expect(member.kind).toBe("native");
    expect(member.tools).toEqual(["files"]);
    expect(member.persona).toContain("研究员");
    expect(c.model.bots[member.id]?.name).toBe("研究员小林");
  });

  it("5. 主线「交给研究员小林调研一下 X」-> 新成员任务在 pi-durable + 假模型上跑完", async () => {
    const before = mark();
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "交给研究员小林调研一下 向量数据库选型" });
    const task = await c.waitFor("小林的任务", (m) => Object.values(m.tasks).find((t) => t.botId === member.id));
    expect(task.parentThreadId).toBe(MAIN_THREAD_ID);
    const done = await untilFinished(task.id);
    expect(done.status).toBe("done");
    expect(done.progress).toBe(100);
    expect((done.tokens ?? 0) + (done.costUsd ?? 0)).toBeGreaterThan(0);

    // 假模型的回答（带人设里的名字）出现在任务线程里
    const bots = entriesOf(done.threadId).filter((e) => e.kind === "bot");
    expect(bots.length).toBeGreaterThan(0);
    expect(bots.some((e) => e.kind === "bot" && e.text.includes("研究员小林") && !e.streaming)).toBe(true);
    // 流式：先有 streaming 的 bot 条目与 entry.delta，之后落定
    expect(c.pushes.some((p) => p.push.kind === "entry.delta" && p.push.threadId === done.threadId)).toBe(true);
    expect(c.pushes.some((p) => p.push.kind === "entry.appended" && p.push.entry.kind === "bot" && p.push.entry.streaming && p.push.entry.threadId === done.threadId)).toBe(true);

    // 请求确实走了假服务：带人设的 system、files 工具组（read）而无 bash/write
    const reqs = nativeReqs(before);
    expect(reqs.length).toBeGreaterThan(0);
    const sys = reqs[0]!.body.messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => String(m.content)).join("\n");
    expect(sys).toContain("你的名字是「研究员小林」");
    expect(sys).toContain("严谨的研究员");
    const toolNames = reqs[0]!.body.tools!.map((t) => t.function?.name);
    expect(toolNames).toEqual(expect.arrayContaining(["read", "ls", "grep"]));
    expect(toolNames).not.toContain("bash");
    expect(toolNames).not.toContain("write");

    // 主线上有 dispatch 条目，且不重复
    const dispatches = entriesOf(MAIN_THREAD_ID).filter((e) => e.kind === "dispatch" && e.taskId === task.id);
    expect(dispatches.length).toBe(1);
  }, 90000);

  it("6. 主线发一句闲聊：Pip 用模型回复；发「帮我查一下」：模型决定派给擅长调研的成员", async () => {
    const before = mark();
    const entriesBefore = entriesOf(MAIN_THREAD_ID).length;
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "你好呀，今天过得怎么样" });
    const reply = await c.waitFor("Pip 的闲聊回复", (m) => {
      const es = (m.entries[MAIN_THREAD_ID] ?? []).slice(entriesBefore);
      return es.find((e) => e.kind === "bot" && e.botId === "bot-pip" && !e.streaming && e.text.includes("我是 Pip"));
    });
    expect(reply.kind === "bot" && reply.text).toContain("fake-chat");
    const reqs = routerReqs(before);
    expect(reqs.length).toBeGreaterThanOrEqual(1);
    // Pip 的 system 提示里有新成员（成员清单现读）
    expect(String(reqs[0]!.body.messages[0]!.content)).toContain("研究员小林");
    expect(reqs[0]!.auth).toBe(`Bearer ${API_KEY}`);

    // 没点名、有「查一下」：模型返回 dispatch，派给擅长调研的成员（先匹配到内置的小探，原生）
    const knownIds = new Set(Object.keys(c.model.tasks));
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "帮我查一下 Rust 的所有权模型" });
    const t2 = await c.waitFor("模型分发出的新任务", (m) => Object.values(m.tasks).find((t) => !knownIds.has(t.id)));
    expect(t2.parentThreadId).toBe(MAIN_THREAD_ID);
    expect(c.model.bots[t2.botId]?.kind).toBe("native");
    expect((await untilFinished(t2.id)).status).toBe("done");
    expect(routerReqs(before).length).toBeGreaterThanOrEqual(2);
  }, 90000);

  it("7. 演示工具链：成员收到「读一下 X」时先 read 再回答", async () => {
    const before = mark();
    const n = tasksOf(member.id).length;
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "交给研究员小林读一下 notes.md 然后总结" });
    await c.waitFor("第三个任务", (m) => Object.values(m.tasks).filter((t) => t.botId === member.id).length > n);
    const t3 = tasksOf(member.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)!;
    const done = await untilFinished(t3.id);
    expect(done.status).toBe("done");
    const reqs = nativeReqs(before);
    expect(reqs.length).toBeGreaterThanOrEqual(2); // 第一次拿到 read 调用，第二次带着工具结果
    expect(reqs.at(-1)!.body.messages.some((m) => m.role === "tool")).toBe(true);
    expect(entriesOf(done.threadId).some((e) => e.kind === "tool_summary" && e.items.some((i) => i.tool === "read"))).toBe(true);
  }, 90000);

  it("8. bot.update 改模型 -> 之后的新任务用新模型", async () => {
    const r = await c.request("bot.update", { botId: member.id, patch: { model: { provider: provider.id, modelId: "fake-2" } } });
    expect(r.bot.model).toEqual({ provider: provider.id, modelId: "fake-2" });
    const before = mark();
    const n = tasksOf(member.id).length;
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "交给研究员小林调研一下 边缘计算" });
    await c.waitFor("新任务", (m) => Object.values(m.tasks).filter((t) => t.botId === member.id).length > n);
    const t = tasksOf(member.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)!;
    await untilFinished(t.id);
    const reqs = nativeReqs(before);
    expect(reqs.length).toBeGreaterThan(0);
    expect(new Set(reqs.map((q) => q.body.model))).toEqual(new Set(["fake-2"]));
  }, 90000);

  it("9. 另建一个临时成员 -> bot.remove；Pip 不可删", async () => {
    const r = await c.request("bot.add", { name: "临时工", kind: "native" });
    temp = r.bot;
    expect(c.model.bots[temp.id]).toBeTruthy();
    await c.request("bot.remove", { botId: temp.id });
    await c.waitFor("成员被移除", (m) => !m.bots[temp.id]);
    await expect(c.request("bot.remove", { botId: "bot-pip" })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("10. 全程所有推送与响应都不含 apiKey；seq 连续", async () => {
    expect(c.raw.filter((s) => s.includes(API_KEY))).toEqual([]);
    expect(c.seqGaps).toEqual([]);
    const credFile = join(dataDir, "credentials.json");
    expect(filesContaining(dataDir, API_KEY, (p) => p === credFile)).toEqual([]);
  });

  it("11. 重启 daemon 后 provider / settings / 成员仍在，key 仍可用", async () => {
    c.close();
    await daemon!.stop();
    daemon = await startDaemon({ dataDir, port: 0, token: TOKEN, fake: false });
    c = await TestClient.connect(daemon.port);

    const snap = await c.request("hub.snapshot", {});
    expect(snap.modelSettings?.router?.provider).toBe(provider.id);
    expect(snap.modelSettings?.native?.provider).toBe(provider.id);
    const bot = snap.bots.find((b) => b.id === member.id);
    expect(bot?.name).toBe("研究员小林");
    expect(bot?.model?.modelId).toBe("fake-2");
    expect(snap.bots.some((b) => b.id === temp.id)).toBe(false);

    const prov = await c.request("model.providers", {});
    const p = prov.providers.find((x) => x.id === provider.id);
    expect(p?.hasApiKey).toBe(true);
    expect(p?.baseUrl).toBe(fake.url);

    const t = await c.request("model.test", { ref: { provider: provider.id, modelId: "fake-2" } });
    expect(t.ok).toBe(true);
    expect(fake.requests.at(-1)?.auth).toBe(`Bearer ${API_KEY}`);

    // 重启后 Pip 仍能用模型分发给保留下来的成员
    const before = mark();
    const n = tasksOf(member.id).length;
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "交给研究员小林调研一下 重启之后" });
    await c.waitFor("重启后的新任务", (m) => Object.values(m.tasks).filter((t) => t.botId === member.id).length > n);
    const nt = tasksOf(member.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)!;
    const done = await untilFinished(nt.id);
    expect(done.status).toBe("done");
    expect(nativeReqs(before).every((q) => q.auth === `Bearer ${API_KEY}`)).toBe(true);
    expect(c.raw.filter((s) => s.includes(API_KEY))).toEqual([]);
  }, 90000);
});
