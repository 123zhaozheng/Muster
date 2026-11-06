import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WirePush } from "@muster/protocol";
import { createHub } from "../core/hub";
import type { ModelService } from "../core/contracts";
import { createModelService } from "./service";

// ───────────── 本地假 OpenAI 兼容服务 ─────────────

const GOOD_KEY = "sk-test-GOODKEY-1234567890";
const BAD_KEY = "sk-test-BADKEY-0987654321";
const MODELS = new Set(["fake-chat", "fake-2"]);

let server: Server;
let baseUrl: string;
let requests: Array<{ path: string; auth?: string; body: any }> = [];

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s ? JSON.parse(s) : {}));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ path: req.url ?? "", auth: req.headers.authorization, body });
    const json = (status: number, obj: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.url !== "/v1/chat/completions") return json(404, { error: { message: "not found" } });
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return json(401, { error: { message: `Incorrect API key provided: ${req.headers.authorization?.slice(7)}`, type: "invalid_request_error" } });
    if (!MODELS.has(body.model)) return json(404, { error: { message: `The model \`${body.model}\` does not exist`, type: "invalid_request_error", code: "model_not_found" } });
    const base = { id: "chatcmpl-1", created: 1, model: body.model };
    if (!body.stream) {
      return json(200, { ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } });
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.write(chunk({ role: "assistant", content: "" }, null));
    res.write(chunk({ content: "O" }, null));
    res.write(chunk({ content: "K" }, null));
    res.write(chunk({}, "stop"));
    res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

// ───────────── helpers ─────────────

const dirs: string[] = [];
afterEach(() => {
  requests = [];
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function open(dir?: string, env: NodeJS.ProcessEnv = {}) {
  const dataDir = dir ?? mkdtempSync(join(tmpdir(), "muster-models-"));
  if (!dir) dirs.push(dataDir);
  const hub = createHub({ dataDir });
  const pushes: WirePush[] = [];
  hub.subscribe((p) => pushes.push(p));
  const svc = createModelService({ hub, dataDir, env });
  const call = <T = any>(name: string, params: unknown = {}) => (svc.handlers as any)[name](params) as Promise<T>;
  return { dataDir, hub, svc, call, pushes };
}

const upsertFake = (call: ReturnType<typeof open>["call"], extra: Record<string, unknown> = {}, apiKey: string | undefined = GOOD_KEY) =>
  call("model.providerUpsert", { provider: { kind: "openai-compatible", name: "假服务", baseUrl, modelIds: ["fake-chat", "fake-2"], enabled: true, ...extra }, apiKey });

// ───────────── tests ─────────────

describe("model catalog", () => {
  it("groups providers, domestic first, with env hints", async () => {
    const { call } = open(undefined, { DEEPSEEK_API_KEY: "sk-x" });
    const { providers } = await call("model.catalog");
    const groups = providers.map((p: any) => p.group);
    expect(groups[0]).toBe("国内");
    const firstNonCn = groups.findIndex((g: string) => g !== "国内");
    expect(groups.slice(0, firstNonCn).every((g: string) => g === "国内")).toBe(true);
    expect(groups.slice(firstNonCn)).not.toContain("国内");
    const byId = Object.fromEntries(providers.map((p: any) => [p.id, p]));
    expect(byId.deepseek).toMatchObject({ group: "国内", envVar: "DEEPSEEK_API_KEY", envConfigured: true });
    expect(byId["moonshotai-cn"].group).toBe("国内");
    expect(byId["minimax-cn"].group).toBe("国内");
    expect(byId.openai).toMatchObject({ group: "国际", envConfigured: false });
    expect(byId.openrouter.group).toBe("聚合");
    expect(byId["amazon-bedrock"].group).toBe("云厂商");
    expect(byId.deepseek.modelCount).toBeGreaterThan(0);
    expect(byId["openai-codex"]).toBeUndefined(); // 无 api key 鉴权
  });
});

describe("custom provider", () => {
  it("configures an OpenAI-compatible provider, lists models, never leaks the key", async () => {
    const { call, hub, svc, pushes, dataDir } = open();
    const { provider } = await upsertFake(call);
    expect(provider).toMatchObject({ kind: "openai-compatible", hasApiKey: true, enabled: true, baseUrl, modelIds: ["fake-chat", "fake-2"] });
    expect(provider.id).toMatch(/^custom-/);

    const listed = await call("model.list", {});
    expect(listed.models.map((m: any) => m.id)).toEqual(["fake-chat", "fake-2"]);
    expect(listed.models[0]).toMatchObject({ provider: provider.id, contextWindow: 128000 });

    await call("model.settingsSet", { settings: { native: { provider: provider.id, modelId: "fake-chat" } } });

    // 密钥不在任何返回值 / 推送 / hub.model / models.json 里，只在 credentials.json。
    const everything = JSON.stringify([provider, listed, await call("model.providers"), await call("model.catalog"), pushes, hub.model, hub.snapshot(), svc.settings()]);
    expect(everything).not.toContain(GOOD_KEY);
    expect(readFileSync(join(dataDir, "models.json"), "utf8")).not.toContain(GOOD_KEY);
    expect(readFileSync(join(dataDir, "credentials.json"), "utf8")).toContain(GOOD_KEY);
    expect(pushes.some((p) => p.push.kind === "models.changed")).toBe(true);
  });

  it("model.test succeeds over SSE with conservative compat; maps 401 / 404 / unreachable / missing key to friendly errors", async () => {
    const { call } = open();
    const { provider } = await upsertFake(call);
    const ok = await call("model.test", { ref: { provider: provider.id, modelId: "fake-chat" } });
    expect(ok).toMatchObject({ ok: true, reply: "OK" });
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    const req = requests.at(-1)!;
    expect(req.auth).toBe(`Bearer ${GOOD_KEY}`);
    expect(req.body.stream).toBe(true);
    expect(req.body.store).toBeUndefined();
    expect(req.body.max_tokens).toBe(32);
    expect(req.body.max_completion_tokens).toBeUndefined();
    expect(JSON.stringify(req.body.messages)).toContain("只回复 OK");

    // 模型不在列表里（本地校验）。
    expect((await call("model.test", { ref: { provider: provider.id, modelId: "nope" } })).error).toMatch(/不在/);

    // 端点上不存在的模型 → 404。
    const ghost = await upsertFake(call, { id: "custom-ghost", modelIds: ["ghost-model"] });
    const r404 = await call("model.test", { ref: { provider: ghost.provider.id, modelId: "ghost-model" } });
    expect(r404.ok).toBe(false);
    expect(r404.error).toMatch(/不存在.*404/);

    // 错误 key → 401，且错误文本里不含密钥。
    await upsertFake(call, { id: provider.id }, BAD_KEY);
    const r401 = await call("model.test", { ref: { provider: provider.id, modelId: "fake-chat" } });
    expect(r401.ok).toBe(false);
    expect(r401.error).toMatch(/401/);
    expect(r401.error).not.toContain(BAD_KEY);

    // 连不上。
    const dead = await call("model.providerUpsert", { provider: { kind: "openai-compatible", name: "死端口", baseUrl: "http://127.0.0.1:1/v1", modelIds: ["m"] }, apiKey: "k" });
    const rDead = await call("model.test", { ref: { provider: dead.provider.id, modelId: "m" } });
    expect(rDead.ok).toBe(false);
    expect(rDead.error).toMatch(/连不上 baseUrl/);

    // 内置 provider 没配 key。
    await call("model.providerUpsert", { provider: { kind: "builtin", builtinId: "deepseek", name: "DeepSeek", enabled: true } });
    const models = (await call("model.list", { providerId: "deepseek" })).models;
    expect(models.length).toBeGreaterThan(0);
    expect((await call("model.test", { ref: { provider: "deepseek", modelId: models[0].id } })).error).toMatch(/API Key/);
  });

  it("apiKey semantics: undefined keeps, empty string clears, string replaces", async () => {
    const { call, dataDir } = open();
    const { provider } = await upsertFake(call);
    const id = provider.id;
    const again = await upsertFake(call, { id, name: "改名" }, undefined);
    expect(again.provider).toMatchObject({ name: "改名", hasApiKey: true, createdAt: provider.createdAt });
    expect((await call("model.test", { ref: { provider: id, modelId: "fake-chat" } })).ok).toBe(true);

    const cleared = await upsertFake(call, { id }, "");
    expect(cleared.provider.hasApiKey).toBe(false);
    expect(readFileSync(join(dataDir, "credentials.json"), "utf8")).not.toContain(GOOD_KEY);
    expect((await call("model.test", { ref: { provider: id, modelId: "fake-chat" } })).error).toMatch(/401/);

    expect((await upsertFake(call, { id }, GOOD_KEY)).provider.hasApiKey).toBe(true);
    expect((await call("model.test", { ref: { provider: id, modelId: "fake-chat" } })).ok).toBe(true);
  });

  it("validates input", async () => {
    const { call } = open();
    const bad = (provider: unknown, apiKey?: string) => call("model.providerUpsert", { provider, apiKey });
    await expect(bad({ kind: "openai-compatible", name: "x", modelIds: ["a"] })).rejects.toMatchObject({ code: "bad_request", message: expect.stringMatching(/baseUrl/) });
    await expect(bad({ kind: "openai-compatible", name: "x", baseUrl: "ftp://h", modelIds: ["a"] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bad({ kind: "openai-compatible", name: "x", baseUrl: "not a url", modelIds: ["a"] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bad({ kind: "anthropic-compatible", name: "x", baseUrl, modelIds: [] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bad({ kind: "openai-compatible", name: "", baseUrl, modelIds: ["a"] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bad({ kind: "builtin", builtinId: "nope", name: "x" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bad({ kind: "openai-compatible", id: "Bad Id", name: "x", baseUrl, modelIds: ["a"] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bad({ kind: "openai-compatible", name: "x", baseUrl, modelIds: ["a"] }, "has space")).rejects.toMatchObject({ code: "bad_request" });
    await expect(call("model.providerDelete", { providerId: "custom-none" })).rejects.toMatchObject({ code: "not_found" });
    await expect(call("model.settingsSet", { settings: { native: { provider: "custom-none", modelId: "m" } } })).rejects.toMatchObject({ code: "bad_request" });
    // 失败的变更不留痕。
    expect((await call("model.providers")).providers).toEqual([]);
  });

  it("supports anthropic-compatible providers and enable/disable", async () => {
    const { call, svc } = open();
    const { provider } = await call("model.providerUpsert", { provider: { kind: "anthropic-compatible", name: "A 兼容", baseUrl: "http://127.0.0.1:9", modelIds: ["claude-x"], enabled: true }, apiKey: "k" });
    expect(svc.models().getModel(provider.id, "claude-x")).toMatchObject({ api: "anthropic-messages" });
    await call("model.providerUpsert", { provider: { ...provider, enabled: false } });
    expect(svc.models().getModel(provider.id, "claude-x")).toBeUndefined();
    expect((await call("model.list", {})).models).toEqual([]);
    expect((await call("model.test", { ref: { provider: provider.id, modelId: "claude-x" } })).error).toMatch(/已停用/);
  });
});

describe("builtin providers", () => {
  it("stores credentials for a builtin provider and uses them (deepseek via a base URL override)", async () => {
    const { call, svc } = open();
    const catalogModel = (await call("model.list", { providerId: "deepseek" }).catch(() => ({ models: [] }))).models;
    expect(catalogModel).toEqual([]); // 未配置前不存在
    const { provider } = await call("model.providerUpsert", { provider: { kind: "builtin", builtinId: "deepseek", name: "DeepSeek", enabled: true, baseUrl }, apiKey: GOOD_KEY });
    expect(provider).toMatchObject({ id: "deepseek", kind: "builtin", builtinId: "deepseek", hasApiKey: true, baseUrl });
    const m = svc.models().getModels("deepseek")[0]!;
    expect(m.baseUrl).toBe(baseUrl);
    // 假服务只认 fake-chat：把白名单改成 fake-chat 并不会让目录凭空多出模型，所以直接用目录里的模型做 404 验证；
    const r = await call("model.test", { ref: { provider: "deepseek", modelId: m.id } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/404/); // 请求确实打到了假服务，并带着存储的 key
    expect(requests.at(-1)!.auth).toBe(`Bearer ${GOOD_KEY}`);
    expect(JSON.stringify(provider)).not.toContain(GOOD_KEY);
  });

  it("modelIds acts as an allow-list for builtin providers", async () => {
    const { call, svc } = open();
    const all = svc.models().getModels("deepseek");
    expect(all).toEqual([]);
    await call("model.providerUpsert", { provider: { kind: "builtin", builtinId: "deepseek", name: "DeepSeek", enabled: true } });
    const ids = svc.models().getModels("deepseek").map((m) => m.id);
    expect(ids.length).toBeGreaterThan(1);
    await call("model.providerUpsert", { provider: { kind: "builtin", builtinId: "deepseek", name: "DeepSeek", enabled: true, modelIds: [ids[0]!] } });
    expect(svc.models().getModels("deepseek").map((m) => m.id)).toEqual([ids[0]]);
    const info = (await call("model.list", { providerId: "deepseek" })).models[0];
    expect(info).toMatchObject({ provider: "deepseek", id: ids[0] });
    expect(typeof info.costInput).toBe("number");
  });
});

describe("settings, persistence, resolve", () => {
  it("persists providers + settings across reopen, restores them into the hub snapshot, and keeps the key usable", async () => {
    const a = open();
    const { provider } = await upsertFake(a.call);
    const ref = { provider: provider.id, modelId: "fake-2" };
    const res = await a.call("model.settingsSet", { settings: { router: ref, native: { provider: provider.id, modelId: "fake-chat" } } });
    expect(res.settings.router).toEqual(ref);
    expect(a.svc.resolve(undefined, "router")).toEqual(ref);
    expect(a.svc.resolve({ provider: provider.id, modelId: "x" }, "router")).toEqual({ provider: provider.id, modelId: "x" });

    const b = open(a.dataDir);
    expect(b.hub.snapshot().modelSettings).toMatchObject({ router: ref, native: { modelId: "fake-chat" } });
    const prov = await b.call("model.providers");
    expect(prov.providers).toHaveLength(1);
    expect(prov.providers[0]).toMatchObject({ id: provider.id, hasApiKey: true, createdAt: provider.createdAt });
    expect(prov.settings.router).toEqual(ref);
    expect((await b.call("model.test", { ref })).ok).toBe(true);
  });

  it("settingsSet validates refs and replaces the whole object; delete clears dangling refs; resolve ignores disabled/missing", async () => {
    const { call, svc, pushes } = open();
    const { provider } = await upsertFake(call);
    const id = provider.id;
    await expect(call("model.settingsSet", { settings: { native: { provider: id, modelId: "nope" } } })).rejects.toMatchObject({ code: "bad_request" });
    await call("model.settingsSet", { settings: { native: { provider: id, modelId: "fake-chat" }, router: { provider: id, modelId: "fake-2" } } });
    await call("model.settingsSet", { settings: { native: { provider: id, modelId: "fake-chat" } } });
    expect(svc.settings()).toEqual({ native: { provider: id, modelId: "fake-chat" } });
    const last = [...pushes].reverse().find((p) => p.push.kind === "models.changed")!;
    expect((last.push as any).settings).toEqual({ native: { provider: id, modelId: "fake-chat" } });

    await call("model.providerUpsert", { provider: { ...provider, enabled: false } });
    expect(svc.resolve(undefined, "native")).toBeUndefined();
    await call("model.providerUpsert", { provider: { ...provider, enabled: true } });
    expect(svc.resolve(undefined, "native")).toBeDefined();
    expect(svc.resolve({ provider: "ghost", modelId: "m" }, "native")).toBeUndefined();

    let changes = 0;
    const off = svc.onChange(() => changes++);
    await call("model.providerDelete", { providerId: id });
    expect(changes).toBe(1);
    off();
    expect(svc.settings()).toEqual({});
    expect(svc.resolve(undefined, "native")).toBeUndefined();
  });

  it("onChange hands out a freshly built Models; old instance stays valid", async () => {
    const { call, svc } = open();
    const before = svc.models();
    let seen: ModelService["models"] extends () => infer M ? M : never = before;
    svc.onChange(() => (seen = svc.models()));
    const { provider } = await upsertFake(call);
    expect(seen).not.toBe(before);
    expect(seen.getModel(provider.id, "fake-chat")).toBeDefined();
    expect(before.getModel(provider.id, "fake-chat")).toBeUndefined();
  });

  it("serializes concurrent mutations", async () => {
    const { call } = open();
    await Promise.all([1, 2, 3, 4, 5].map((i) => upsertFake(call, { name: `p${i}` }, `key-${i}`)));
    expect((await call("model.providers")).providers).toHaveLength(5);
  });
});

describe("environment fallback", () => {
  it("MUSTER_NATIVE_* / MUSTER_ROUTER_* become implicit providers + default settings (and work)", async () => {
    const { call, svc } = open(undefined, {
      MUSTER_NATIVE_MODEL: "fake-chat", MUSTER_NATIVE_BASE_URL: baseUrl, MUSTER_NATIVE_API_KEY: GOOD_KEY,
      MUSTER_ROUTER_LLM: "1", MUSTER_ROUTER_BASE_URL: baseUrl, MUSTER_ROUTER_API_KEY: GOOD_KEY, MUSTER_ROUTER_MODEL: "fake-2",
    });
    expect(svc.settings()).toEqual({ native: { provider: "env-native", modelId: "fake-chat" }, router: { provider: "env-router", modelId: "fake-2" } });
    const { providers } = await call("model.providers");
    expect(providers.map((p: any) => p.id)).toEqual(["env-native", "env-router"]);
    expect(providers[0].name).toContain("环境变量");
    expect(JSON.stringify(providers)).not.toContain(GOOD_KEY);
    expect(svc.resolve(undefined, "native")).toEqual({ provider: "env-native", modelId: "fake-chat" });
    expect((await call("model.test", { ref: { provider: "env-native", modelId: "fake-chat" } })).ok).toBe(true);
    await expect(call("model.providerDelete", { providerId: "env-native" })).rejects.toMatchObject({ code: "not_found" });
    await expect(call("model.providerUpsert", { provider: { id: "env-native", kind: "openai-compatible", name: "x", baseUrl, modelIds: ["a"] } })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("builtin env keys and the legacy OPENAI_API_KEY + MUSTER_NATIVE_MODEL pair work; user config takes over", async () => {
    const { call, svc, hub } = open(undefined, { OPENAI_API_KEY: "sk-env", DEEPSEEK_API_KEY: "sk-ds", MUSTER_NATIVE_MODEL: "gpt-4o-mini" });
    const { providers } = await call("model.providers");
    expect(providers.map((p: any) => p.id).sort()).toEqual(["deepseek", "openai"]);
    expect(providers.every((p: any) => p.hasApiKey && p.kind === "builtin")).toBe(true);
    expect(svc.settings().native).toEqual({ provider: "openai", modelId: "gpt-4o-mini" });
    expect(hub.snapshot().modelSettings?.native?.provider).toBe("openai");
    expect((await call("model.list", {})).models.length).toBeGreaterThan(0);

    await upsertFake(call);
    expect((await call("model.providers")).providers.map((p: any) => p.kind)).toEqual(["openai-compatible"]);
    expect(svc.settings()).toEqual({});
  });

  it("without any config nothing is resolved", async () => {
    const { svc, call } = open();
    expect(svc.resolve(undefined, "native")).toBeUndefined();
    expect(svc.resolve(undefined, "router")).toBeUndefined();
    expect((await call("model.providers")).providers).toEqual([]);
    expect((await call("model.list", {})).models).toEqual([]);
  });
});

describe("credential file", () => {
  it("survives corrupt files by backing them up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muster-models-"));
    dirs.push(dir);
    writeFileSync(join(dir, "models.json"), "{ not json");
    writeFileSync(join(dir, "credentials.json"), "garbage");
    const { call } = open(dir);
    expect((await call("model.providers")).providers).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.includes(".corrupt-")).length).toBe(2);
    await upsertFake(call);
    expect(JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8"))).toBeTypeOf("object");
  });
});
