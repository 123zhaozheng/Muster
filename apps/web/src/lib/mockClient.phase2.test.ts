// 二期：成员增改删、模型目录 / provider / 列表 / 测试 / 默认模型、任务进度平滑推进。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WirePush } from "@muster/protocol";
import { applyPush, modelFromSnapshot } from "@muster/protocol/reducer";
import { createMockClient, type MockClient } from "./mockClient";

let c: MockClient;
let pushes: WirePush[];
const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const kinds = () => pushes.map((p) => p.push.kind);
const DEEPSEEK = { provider: "deepseek", modelId: "deepseek-flash" };

beforeEach(() => {
  vi.useFakeTimers();
  c = createMockClient({ stepMs: 100, typeMs: 1, scanMs: 0 });
  pushes = [];
  c.onPush((p) => pushes.push(p));
});
afterEach(() => {
  c.close();
  vi.useRealTimers();
});

/** 发起 model.test 并推进假时钟，返回结果。 */
async function testModel(ref: { provider: string; modelId: string }) {
  const p = c.request("model.test", { ref });
  await run(1000);
  return p;
}

describe("演示数据", () => {
  it("预置 DeepSeek provider（hasApiKey）与默认模型，snapshot 带 modelSettings，key 不外泄", async () => {
    const snap = await c.request("hub.snapshot", {});
    expect(snap.modelSettings).toEqual({ router: DEEPSEEK, native: DEEPSEEK });
    const { providers, settings } = await c.request("model.providers", {});
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ id: "deepseek", kind: "builtin", builtinId: "deepseek", hasApiKey: true, enabled: true });
    expect(settings).toEqual({ router: DEEPSEEK, native: DEEPSEEK });
    expect(JSON.stringify({ snap, providers })).not.toMatch(/sk-demo/);
    expect(providers[0]).not.toHaveProperty("apiKey");
  });

  it("有原生自建成员「小译」（persona / tools / model 完整），内置成员带 builtin 标记", async () => {
    const { bots } = await c.request("hub.snapshot", {});
    const xy = bots.find((b) => b.name === "小译");
    expect(xy).toMatchObject({ kind: "native", model: DEEPSEEK, builtin: false });
    expect(xy?.persona).toBeTruthy();
    expect(xy?.tools).toEqual(["files", "web"]);
    for (const id of ["bot-pip", "bot-xiaotan", "bot-xiaowen"]) expect(bots.find((b) => b.id === id)?.builtin).toBe(true);
    expect(bots.find((b) => b.id === "bot-xiaotan")?.persona).toBeTruthy();
    // 一期的 Codex / Claude 成员不受影响
    expect(bots.find((b) => b.id === "bot-xiaoma")?.kind).toBe("codex");
  });
});

describe("model.catalog", () => {
  it("给出逼真的内置目录：分组、环境变量、模型数量", async () => {
    const { providers } = await c.request("model.catalog", {});
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    for (const id of ["deepseek", "moonshotai-cn", "minimax-cn", "zai", "qwen-token-plan-cn", "openai", "anthropic", "google", "openrouter", "ollama"]) {
      expect(byId[id], id).toBeDefined();
    }
    expect(byId.deepseek).toMatchObject({ group: "国内", envVar: "DEEPSEEK_API_KEY", envConfigured: false });
    expect(byId.deepseek!.modelCount).toBeGreaterThan(0);
    expect(byId.anthropic!.group).toBe("国际");
    expect(byId.openrouter!.group).toBe("聚合");
    expect(byId.ollama).toMatchObject({ group: "本地", baseUrl: "http://localhost:11434/v1" });
    // 国内排在最前
    expect(providers[0]!.group).toBe("国内");
  });
});

describe("model.providerUpsert / providerDelete", () => {
  it("新增内置 provider：key 只记 hasApiKey，并推送 models.changed；undefined 保留、空串清除", async () => {
    const { provider } = await c.request("model.providerUpsert", {
      provider: { kind: "builtin", builtinId: "moonshotai-cn", name: "", enabled: true },
      apiKey: "sk-moon-123",
    });
    expect(provider).toMatchObject({ id: "moonshotai-cn", name: "Moonshot (China)", hasApiKey: true, enabled: true });
    expect(JSON.stringify(provider)).not.toContain("sk-moon-123");
    expect(kinds()).toContain("models.changed");

    const keep = await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "moonshotai-cn", name: "月之暗面", enabled: true } });
    expect(keep.provider).toMatchObject({ hasApiKey: true, name: "月之暗面", createdAt: provider.createdAt });
    const cleared = await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "moonshotai-cn", name: "", enabled: true }, apiKey: "" });
    expect(cleared.provider.hasApiKey).toBe(false);
    expect((await c.request("model.providers", {})).providers.map((p) => p.id)).toEqual(["deepseek", "moonshotai-cn"]);
  });

  it("自定义 OpenAI 兼容 provider：生成 custom-xxxx id，需要名称 / 网址 / 至少一个模型", async () => {
    const { provider } = await c.request("model.providerUpsert", {
      provider: { kind: "openai-compatible", name: "公司网关", baseUrl: "http://localhost:11434/v1/", modelIds: ["qwen3:8b", "qwen3:8b", " llama3 "], enabled: true },
    });
    expect(provider.id).toMatch(/^custom-[a-z0-9-]+$/);
    expect(provider).toMatchObject({ baseUrl: "http://localhost:11434/v1", modelIds: ["qwen3:8b", "llama3"], hasApiKey: false });
    const { models } = await c.request("model.list", { providerId: provider.id });
    expect(models.map((m) => m.id)).toEqual(["qwen3:8b", "llama3"]);
    expect(models.every((m) => m.provider === provider.id)).toBe(true);

    const base = { kind: "openai-compatible" as const, enabled: true };
    await expect(c.request("model.providerUpsert", { provider: { ...base, name: "x", modelIds: ["a"] } })).rejects.toThrow(/bad_request.*baseUrl/);
    await expect(c.request("model.providerUpsert", { provider: { ...base, name: "x", baseUrl: "ftp://a", modelIds: ["a"] } })).rejects.toThrow(/http/);
    await expect(c.request("model.providerUpsert", { provider: { ...base, name: "x", baseUrl: "not a url", modelIds: ["a"] } })).rejects.toThrow(/bad_request/);
    await expect(c.request("model.providerUpsert", { provider: { ...base, name: "", baseUrl: "http://a.b", modelIds: ["a"] } })).rejects.toThrow(/名称/);
    await expect(c.request("model.providerUpsert", { provider: { ...base, name: "x", baseUrl: "http://a.b" } })).rejects.toThrow(/模型 ID/);
  });

  it("校验：未知内置 id、非法 key、未知类型", async () => {
    await expect(c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "nope", name: "", enabled: true } })).rejects.toThrow(/bad_request/);
    await expect(c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "openai", name: "", enabled: true }, apiKey: "sk a b" })).rejects.toThrow(/空格/);
    await expect(c.request("model.providerUpsert", { provider: { kind: "weird" as never, name: "", enabled: true } })).rejects.toThrow(/类型/);
  });

  it("删除 provider：清掉指向它的默认模型与成员模型，推送 models.changed / bot.updated；未知 id not_found", async () => {
    await c.request("model.providerDelete", { providerId: "deepseek" });
    expect((await c.request("model.providers", {})).providers).toEqual([]);
    expect(c.getModel().modelSettings).toEqual({});
    expect(c.getModel().bots["bot-xiaoyi"]?.model).toBeUndefined();
    expect(c.getModel().bots["bot-xiaowen"]?.model).toBeUndefined();
    expect(kinds()).toContain("bot.updated");
    expect(pushes.at(-1)?.push).toEqual({ kind: "models.changed", settings: {} });
    await expect(c.request("model.providerDelete", { providerId: "deepseek" })).rejects.toThrow(/not_found/);
  });
});

describe("model.list", () => {
  it("每个已启用 provider 给 2~4 个带价格 / 上下文的模型；停用的不列出，指定 providerId 仍可取", async () => {
    for (const id of ["anthropic", "openai", "zai"]) {
      await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: id, name: "", enabled: true }, apiKey: "k" });
    }
    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "google", name: "", enabled: false } });
    const { models } = await c.request("model.list", {});
    const by = (id: string) => models.filter((m) => m.provider === id);
    for (const id of ["deepseek", "anthropic", "openai", "zai"]) {
      expect(by(id).length, id).toBeGreaterThanOrEqual(2);
      expect(by(id).length, id).toBeLessThanOrEqual(4);
    }
    expect(by("google")).toHaveLength(0);
    const sonnet = by("anthropic").find((m) => m.id === "claude-sonnet-4-5");
    expect(sonnet).toMatchObject({ contextWindow: 200_000, reasoning: true, vision: true, costInput: 3, costOutput: 15 });
    expect((await c.request("model.list", { providerId: "google" })).models.length).toBeGreaterThanOrEqual(2);
    await expect(c.request("model.list", { providerId: "nope" })).rejects.toThrow(/not_found/);
  });

  it("内置 provider 的 modelIds 作为白名单", async () => {
    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "deepseek", name: "", enabled: true, modelIds: ["deepseek-v4-pro"] } });
    expect((await c.request("model.list", { providerId: "deepseek" })).models.map((m) => m.id)).toEqual(["deepseek-v4-pro"]);
  });
});

describe("model.test", () => {
  it("成功：模拟 300~900ms 延迟，返回 OK 与耗时", async () => {
    let settled = false;
    const p = c.request("model.test", { ref: DEEPSEEK }).then((r) => ((settled = true), r));
    await run(250);
    expect(settled).toBe(false);
    await run(700);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.reply).toBe("OK");
    expect(r.latencyMs).toBeGreaterThanOrEqual(300);
    expect(r.latencyMs).toBeLessThanOrEqual(900);
  });

  it("key 为 bad 时失败 401；没配 key、模型不存在、provider 不存在、已停用都给出明确错误而不是抛异常", async () => {
    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "openai", name: "", enabled: true }, apiKey: "bad" });
    const bad = await testModel({ provider: "openai", modelId: "gpt-4.1" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/401/);

    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "anthropic", name: "", enabled: true } });
    expect((await testModel({ provider: "anthropic", modelId: "claude-sonnet-4-5" })).error).toMatch(/API Key/);
    expect((await testModel({ provider: "deepseek", modelId: "no-such" })).error).toMatch(/no-such/);
    expect((await testModel({ provider: "nope", modelId: "x" })).error).toMatch(/不存在/);
    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "deepseek", name: "", enabled: false } });
    expect((await testModel(DEEPSEEK)).error).toMatch(/停用/);
    await expect(c.request("model.test", { ref: { provider: "", modelId: "" } })).rejects.toThrow(/bad_request/);
  });

  it("本地 provider（Ollama）不需要 key", async () => {
    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "ollama", name: "", enabled: true } });
    expect((await testModel({ provider: "ollama", modelId: "qwen3:8b" })).ok).toBe(true);
  });
});

describe("model.settingsSet", () => {
  it("保存并推送 models.changed；可只设其中一项、也可清空", async () => {
    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "anthropic", name: "", enabled: true }, apiKey: "k" });
    const ref = { provider: "anthropic", modelId: "claude-sonnet-4-5" };
    const { settings } = await c.request("model.settingsSet", { settings: { router: DEEPSEEK, native: ref } });
    expect(settings).toEqual({ router: DEEPSEEK, native: ref });
    expect(pushes.at(-1)?.push).toEqual({ kind: "models.changed", settings: { router: DEEPSEEK, native: ref } });
    expect(c.getModel().modelSettings).toEqual({ router: DEEPSEEK, native: ref });
    expect((await c.request("model.providers", {})).settings).toEqual({ router: DEEPSEEK, native: ref });

    expect((await c.request("model.settingsSet", { settings: { native: DEEPSEEK } })).settings).toEqual({ native: DEEPSEEK });
    expect((await c.request("hub.snapshot", {})).modelSettings).toEqual({ native: DEEPSEEK });
    expect((await c.request("model.settingsSet", { settings: {} })).settings).toEqual({});
  });

  it("校验：provider 不存在 / 已停用 / 没有该模型", async () => {
    await expect(c.request("model.settingsSet", { settings: { router: { provider: "nope", modelId: "x" } } })).rejects.toThrow(/不存在/);
    await expect(c.request("model.settingsSet", { settings: { router: { provider: "deepseek", modelId: "nope" } } })).rejects.toThrow(/没有模型/);
    await expect(c.request("model.settingsSet", { settings: { native: { provider: "deepseek", modelId: "" } } })).rejects.toThrow(/bad_request/);
    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "deepseek", name: "", enabled: false } });
    await expect(c.request("model.settingsSet", { settings: { router: DEEPSEEK } })).rejects.toThrow(/停用/);
  });

  it("push 重放后与内部状态一致（含 modelSettings 与成员字段）", async () => {
    const snap = await c.request("hub.snapshot", {});
    await c.request("model.providerUpsert", { provider: { kind: "builtin", builtinId: "openai", name: "", enabled: true }, apiKey: "k" });
    await c.request("model.settingsSet", { settings: { native: { provider: "openai", modelId: "gpt-4.1" } } });
    await c.request("bot.update", { botId: "bot-xiaoyi", patch: { model: { provider: "openai", modelId: "gpt-4.1-mini" }, tagline: "新签名" } });
    await c.request("model.providerDelete", { providerId: "deepseek" });
    let replay = modelFromSnapshot(snap);
    pushes.forEach((p, i) => {
      expect(p.seq).toBe(snap.seq + 1 + i);
      replay = { ...applyPush(replay, p.push), seq: p.seq };
    });
    const live = c.getModel();
    expect(replay.modelSettings).toEqual(live.modelSettings);
    expect(replay.bots).toEqual(live.bots);
  });
});

describe("bot.add / bot.update / bot.remove", () => {
  it("bot.add 创建原生成员：persona / model / tools / skills / tagline 全部落地", async () => {
    const { bot } = await c.request("bot.add", {
      name: "小审",
      kind: "native",
      tagline: "代码审查",
      persona: "  你是一位严格的代码审查员。 ",
      model: DEEPSEEK,
      tools: ["files", "shell", "files"],
      skills: ["代码审查"],
    });
    expect(bot).toMatchObject({ kind: "native", engineLabel: "内置 Bot", tagline: "代码审查", persona: "你是一位严格的代码审查员。", model: DEEPSEEK, tools: ["files", "shell"], skills: ["代码审查"], builtin: false });
    expect(c.getModel().bots[bot.id]).toEqual(bot);
    expect(kinds()).toContain("bot.added");
  });

  it("bot.add 校验：未指定 tools 的原生成员默认只读文件；model 的 provider 必须存在；tools 取值受限", async () => {
    const { bot } = await c.request("bot.add", { name: "小简", kind: "native" });
    expect(bot.tools).toEqual(["files"]);
    expect(bot.persona).toBeUndefined();
    await expect(c.request("bot.add", { name: "甲", kind: "native", model: { provider: "nope", modelId: "x" } })).rejects.toThrow(/bad_request/);
    await expect(c.request("bot.add", { name: "乙", kind: "native", tools: ["rm" as never] })).rejects.toThrow(/tools/);
    await expect(c.request("bot.add", { name: "小译", kind: "native" })).rejects.toThrow(/conflict/);
    // 一期流程不变：外部引擎成员不带 tools
    expect((await c.request("bot.add", { name: "丙", kind: "claude" })).bot.tools).toBeUndefined();
  });

  it("bot.update：改字段、清空可选字段、重名 conflict、未知 not_found，并推送 bot.updated", async () => {
    const { bot } = await c.request("bot.update", {
      botId: "bot-xiaoyi",
      patch: { name: "小译译", tagline: "新的签名", persona: "新人设", tools: ["files", "edit"], color: "sky", shape: "egg", skills: ["a"] },
    });
    expect(bot).toMatchObject({ name: "小译译", tagline: "新的签名", persona: "新人设", tools: ["files", "edit"], color: "sky", shape: "egg", skills: ["a"], kind: "native", id: "bot-xiaoyi" });
    expect(pushes.at(-1)?.push).toEqual({ kind: "bot.updated", bot });

    const cleared = (await c.request("bot.update", { botId: "bot-xiaoyi", patch: { model: undefined, persona: "", tagline: undefined } })).bot;
    expect(cleared).not.toHaveProperty("model");
    expect(cleared).not.toHaveProperty("persona");
    expect(cleared).not.toHaveProperty("tagline");
    expect(c.getModel().bots["bot-xiaoyi"]).toEqual(cleared);

    await expect(c.request("bot.update", { botId: "bot-xiaoyi", patch: { name: "小码" } })).rejects.toThrow(/conflict/);
    await expect(c.request("bot.update", { botId: "bot-xiaoyi", patch: { name: "  " } })).rejects.toThrow(/bad_request/);
    await expect(c.request("bot.update", { botId: "bot-xiaoyi", patch: { model: { provider: "nope", modelId: "x" } } })).rejects.toThrow(/bad_request/);
    await expect(c.request("bot.update", { botId: "nope", patch: { name: "x" } })).rejects.toThrow(/not_found/);
    // 内置成员可以编辑，不动状态等字段
    const pip = (await c.request("bot.update", { botId: "bot-pip", patch: { tagline: "路由" } })).bot;
    expect(pip).toMatchObject({ tagline: "路由", kind: "main", builtin: true });
  });

  it("bot.remove：删除自建成员并推送 bot.removed；内置 / 主 Bot 拒绝；有进行中任务时 conflict", async () => {
    const { bot } = await c.request("bot.add", { name: "临时工", kind: "native" });
    expect(await c.request("bot.remove", { botId: bot.id })).toEqual({ ok: true });
    expect(c.getModel().bots[bot.id]).toBeUndefined();
    expect(pushes.at(-1)?.push).toEqual({ kind: "bot.removed", botId: bot.id });
    await expect(c.request("bot.remove", { botId: bot.id })).rejects.toThrow(/not_found/);
    await expect(c.request("bot.remove", { botId: "bot-pip" })).rejects.toThrow(/bad_request/);
    await expect(c.request("bot.remove", { botId: "bot-xiaotan" })).rejects.toThrow(/内置/);
    await expect(c.request("bot.remove", { botId: "bot-xiaoma" })).rejects.toThrow(/conflict/); // 夹具里正在跑任务
  });

  it("原生成员可以被主线派发任务", async () => {
    await c.request("chat.send", { threadId: "thread-main", text: "交给小译翻译这份 README" });
    await run(2000);
    const task = Object.values(c.getModel().tasks).find((t) => t.botId === "bot-xiaoyi");
    expect(task?.title).toContain("翻译");
  });

  it("原生成员没有可用模型时，在自己的线程里给出「去配置模型」的引导", async () => {
    await c.request("bot.update", { botId: "bot-xiaoyi", patch: { model: undefined } });
    await c.request("model.providerDelete", { providerId: "deepseek" });
    await c.request("chat.send", { threadId: "thread-bot-xiaoyi", text: "你好" });
    await run(500);
    const last = c.getModel().entries["thread-bot-xiaoyi"]?.findLast((e) => e.kind === "bot");
    expect(last && last.kind === "bot" && last.text).toMatch(/设置 · 模型/);
  });
});

describe("任务进度平滑推进", () => {
  it("运行中的任务每 600ms 上涨 3~8%，最高停在 94%，不到 100", async () => {
    c.close();
    c = createMockClient({ stepMs: 1_000_000, typeMs: 1, scanMs: 0 });
    const id = "task-fix-callback";
    const seen: number[] = [c.getModel().tasks[id]!.progress!];
    for (let i = 0; i < 12; i++) {
      await run(600);
      seen.push(c.getModel().tasks[id]!.progress!);
    }
    for (let i = 1; i < seen.length; i++) {
      const d = seen[i]! - seen[i - 1]!;
      if (seen[i - 1]! < 94) {
        expect(d).toBeGreaterThanOrEqual(Math.min(3, 94 - seen[i - 1]!));
        expect(d).toBeLessThanOrEqual(8);
      } else {
        expect(d).toBe(0);
      }
    }
    expect(seen.at(-1)).toBe(94);
  });

  it("等待审批的任务进度不动；progressMs=0 可关闭", async () => {
    const waiting = "task-refund-api";
    const before = c.getModel().tasks[waiting]!.progress;
    await run(3000);
    expect(c.getModel().tasks[waiting]!.progress).toBe(before);

    c.close();
    c = createMockClient({ stepMs: 1_000_000, typeMs: 1, scanMs: 0, progressMs: 0 });
    const p0 = c.getModel().tasks["task-fix-callback"]!.progress;
    await run(5000);
    expect(c.getModel().tasks["task-fix-callback"]!.progress).toBe(p0);
  });
});
