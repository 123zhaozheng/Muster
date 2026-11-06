import { describe, expect, it } from "vitest";
import type { Bot } from "@muster/protocol";
import type { AgentDriver, DriverRegistry } from "../core/contracts";
import { createHub } from "../core/hub";
import { createMiscHandlers } from "./misc";

const driver = (kind: AgentDriver["kind"]): AgentDriver => ({
  kind,
  detect: async () => ({ engine: kind === "codex" || kind === "claude" ? kind : "other", command: kind, found: true }),
  start: async () => {
    throw new Error("n/a");
  },
});

function setup() {
  const hub = createHub({ dataDir: "unused" });
  const drivers: DriverRegistry = new Map([["codex", driver("codex")], ["native", driver("native")]]);
  const h = createMiscHandlers({ hub, drivers });
  const call = <T>(name: string, p: unknown = {}) => (h as any)[name](p) as Promise<T>;
  const add = async (p: Record<string, unknown>) => (await call<{ bot: Bot }>("bot.add", p)).bot;
  const update = (botId: string, patch: Record<string, unknown>) => call<{ bot: Bot }>("bot.update", { botId, patch });
  return { hub, call, add, update };
}

const runningTask = (botId: string, status: "running" | "waiting_approval" | "done" = "running") => ({
  id: `task-${botId}-${status}`, title: "t", botId, threadId: `thread-${botId}`, parentThreadId: "thread-main", status, startedAt: "2026-11-06T00:00:00Z",
});

describe("bot.add (phase 2)", () => {
  it("native: default tools ['files'] and label 原生 · 默认模型; persona / model / skills stored", async () => {
    const { add, hub } = setup();
    const a = await add({ name: "小研", kind: "native" });
    expect(a).toMatchObject({ kind: "native", engineLabel: "原生 · 默认模型", tools: ["files"], skills: [], costWeekUsd: 0 });
    expect(a.persona).toBeUndefined();

    const b = await add({
      name: "小析", kind: "native", tagline: " 数据分析 ", persona: "你是分析师", model: { provider: "deepseek", modelId: "deepseek-chat" },
      tools: ["files", "web", "files"], skills: ["数据", " 数据 ", "图表", ""],
    });
    expect(b).toMatchObject({
      engineLabel: "原生 · deepseek-chat", tagline: "数据分析", persona: "你是分析师", model: { provider: "deepseek", modelId: "deepseek-chat" },
      tools: ["files", "web"], skills: ["数据", "图表"],
    });
    expect(hub.model.bots[b.id]).toEqual(b);
    expect(b.builtin).toBeUndefined();
  });

  it("explicit engineLabel wins; non-native gets no default tools", async () => {
    const { add } = setup();
    const a = await add({ name: "小原", kind: "native", engineLabel: "我的研究员" });
    expect(a.engineLabel).toBe("我的研究员");
    const c = await add({ name: "小新", kind: "codex" });
    expect(c.tools).toBeUndefined();
    expect(c.engineLabel).toBe("Codex");
  });

  it("rejects bad input", async () => {
    const { call } = setup();
    const bad = (p: Record<string, unknown>) => expect(call("bot.add", { name: "x", kind: "native", ...p })).rejects.toMatchObject({ code: "bad_request" });
    await bad({ tools: ["files", "rm"] });
    await bad({ tools: "files" });
    await bad({ model: { provider: "", modelId: "m" } });
    await bad({ model: "gpt" });
    await bad({ skills: "a" });
    await bad({ color: "red" });
    await bad({ shape: "star" });
    await bad({ persona: "x".repeat(9000) });
    await bad({ kind: "claude" }); // no driver
    await expect(call("bot.add", { name: "小探", kind: "native" })).rejects.toMatchObject({ code: "conflict" }); // seed name
  });
});

describe("bot.update", () => {
  it("edits fields, commits bot.updated, clears optional fields, keeps identity fields", async () => {
    const { add, update, hub } = setup();
    const a = await add({ name: "小研", kind: "native", tagline: "旧", persona: "旧人设", model: { provider: "p", modelId: "m1" } });
    const pushes: string[] = [];
    hub.subscribe((p) => pushes.push(p.push.kind));

    const { bot } = await update(a.id, { name: "小研2", tagline: "", persona: "新人设", color: "rose", shape: "egg", skills: ["a", "b"], tools: ["files", "edit"], model: null });
    expect(bot).toMatchObject({ id: a.id, kind: "native", status: "idle", name: "小研2", persona: "新人设", color: "rose", shape: "egg", skills: ["a", "b"], tools: ["files", "edit"] });
    expect("tagline" in bot).toBe(false);
    expect("model" in bot).toBe(false);
    expect(bot.engineLabel).toBe("原生 · 默认模型"); // auto label follows the model
    expect(pushes).toEqual(["bot.updated"]);
    expect(hub.model.bots[a.id]).toEqual(bot);
  });

  it("auto native label follows model changes, but a custom or seed label stays", async () => {
    const { add, update } = setup();
    const a = await add({ name: "小研", kind: "native" });
    expect((await update(a.id, { model: { provider: "p", modelId: "kimi-k2" } })).bot.engineLabel).toBe("原生 · kimi-k2");
    const b = await add({ name: "小定", kind: "native", engineLabel: "自定义" });
    expect((await update(b.id, { model: { provider: "p", modelId: "x" } })).bot.engineLabel).toBe("自定义");
    expect((await update("bot-xiaotan", { model: { provider: "p", modelId: "x" } })).bot.engineLabel).toBe("内置研究员");
    expect((await update(a.id, { model: { provider: "p", modelId: "y" }, engineLabel: "手动" })).bot.engineLabel).toBe("手动");
  });

  it("no-op patches do not commit", async () => {
    const { add, update, hub } = setup();
    const a = await add({ name: "小研", kind: "native" });
    const pushes: string[] = [];
    hub.subscribe((p) => pushes.push(p.push.kind));
    await update(a.id, { name: "小研" });
    await update(a.id, {});
    expect(pushes).toEqual([]);
  });

  it("validation: unknown bot, forbidden/unknown keys, duplicate name, bad values", async () => {
    const { add, update } = setup();
    const a = await add({ name: "小研", kind: "native" });
    await expect(update("nope", { name: "x" })).rejects.toMatchObject({ code: "not_found" });
    await expect(update(a.id, { status: "working" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(update(a.id, { kind: "codex" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(update(a.id, { id: "x" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(update(a.id, { name: "小探" })).rejects.toMatchObject({ code: "conflict" });
    await expect(update(a.id, { name: "  " })).rejects.toMatchObject({ code: "bad_request" });
    await expect(update(a.id, { tools: ["x"] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(update(a.id, { color: "x" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(update(a.id, undefined as any)).rejects.toMatchObject({ code: "bad_request" });
  });

  it("main bot (Pip): only name / shape / color / model", async () => {
    const { update, hub } = setup();
    const pip = Object.values(hub.model.bots).find((b) => b.kind === "main")!;
    const { bot } = await update(pip.id, { name: "皮普", color: "sky", shape: "egg", model: { provider: "deepseek", modelId: "deepseek-chat" } });
    expect(bot).toMatchObject({ name: "皮普", color: "sky", model: { modelId: "deepseek-chat" }, engineLabel: pip.engineLabel });
    for (const patch of [{ persona: "x" }, { tools: ["files"] }, { skills: [] }, { tagline: "x" }, { engineLabel: "x" }]) {
      await expect(update(pip.id, patch)).rejects.toMatchObject({ code: "bad_request" });
    }
  });

  it("seed bots remain editable", async () => {
    const { update } = setup();
    expect((await update("bot-xiaotan", { persona: "新的人设", tools: ["files"] })).bot).toMatchObject({ persona: "新的人设", tools: ["files"], builtin: true });
  });
});

describe("bot.remove", () => {
  it("removes a user-created bot and commits bot.removed", async () => {
    const { add, call, hub } = setup();
    const a = await add({ name: "小研", kind: "native" });
    const pushes: any[] = [];
    hub.subscribe((p) => pushes.push(p.push));
    await expect(call("bot.remove", { botId: a.id })).resolves.toEqual({ ok: true });
    expect(hub.model.bots[a.id]).toBeUndefined();
    expect(pushes).toEqual([{ kind: "bot.removed", botId: a.id }]);
    await expect(call("bot.remove", { botId: a.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("cannot remove main or builtin bots", async () => {
    const { call, hub } = setup();
    const pip = Object.values(hub.model.bots).find((b) => b.kind === "main")!;
    await expect(call("bot.remove", { botId: pip.id })).rejects.toMatchObject({ code: "bad_request" });
    await expect(call("bot.remove", { botId: "bot-xiaoma" })).rejects.toMatchObject({ code: "bad_request" });
    expect(hub.model.bots["bot-xiaoma"]).toBeDefined();
  });

  it("conflicts while a task is running or waiting for approval; finished tasks do not block", async () => {
    const { add, call, hub } = setup();
    const a = await add({ name: "小研", kind: "native" });
    hub.commit({ kind: "task.updated", task: runningTask(a.id, "done") });
    hub.commit({ kind: "task.updated", task: runningTask(a.id, "running") });
    await expect(call("bot.remove", { botId: a.id })).rejects.toMatchObject({ code: "conflict" });
    hub.commit({ kind: "task.updated", task: { ...runningTask(a.id, "running"), status: "waiting_approval" } });
    await expect(call("bot.remove", { botId: a.id })).rejects.toMatchObject({ code: "conflict" });
    expect(hub.model.bots[a.id]).toBeDefined();
    hub.commit({ kind: "task.updated", task: { ...runningTask(a.id, "running"), status: "done" } });
    await expect(call("bot.remove", { botId: a.id })).resolves.toEqual({ ok: true });
  });
});
