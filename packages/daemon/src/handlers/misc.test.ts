import { describe, expect, it } from "vitest";
import type { DetectedAgent } from "@muster/protocol";
import type { AgentDriver, DriverRegistry } from "../core/contracts";
import { createHub } from "../core/hub";
import { createMiscHandlers } from "./misc";

const driver = (kind: AgentDriver["kind"], detect: AgentDriver["detect"]): AgentDriver => ({ kind, detect, start: async () => { throw new Error("n/a"); } });

function setup(drivers: DriverRegistry = new Map()) {
  const hub = createHub({ dataDir: "unused" });
  const missing: DetectedAgent = { engine: "opencode", command: "opencode", found: false };
  const h = createMiscHandlers({ hub, drivers, detectOpencode: async () => missing });
  return { hub, h, call: <T>(name: string, p: unknown = {}) => (h as any)[name](p) as Promise<T> };
}

describe("misc handlers", () => {
  it("thread.get returns entries (with limit) or not_found", async () => {
    const { hub, call } = setup();
    for (let i = 0; i < 3; i++) hub.commit({ kind: "entry.appended", entry: { id: `e${i}`, threadId: "thread-main", ts: `2026-11-06T00:00:0${i}Z`, kind: "user", text: `${i}` } });
    expect((await call<any>("thread.get", { threadId: "thread-main" })).entries).toHaveLength(3);
    expect((await call<any>("thread.get", { threadId: "thread-main", limit: 2 })).entries.map((e: any) => e.id)).toEqual(["e1", "e2"]);
    await expect(call("thread.get", { threadId: "zzz" })).rejects.toMatchObject({ code: "not_found" });
    await expect(call("thread.get", { threadId: "thread-main", limit: 0 })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("event.list filters by source, pages with before, defaults limit to 100", async () => {
    const { hub, call } = setup();
    for (let i = 0; i < 120; i++) {
      const ts = new Date(Date.UTC(2026, 10, 6, 0, 0, i)).toISOString();
      hub.commit({ kind: "event.logged", event: { id: `ev${i}`, ts, source: i % 2 ? "cron" : "github", title: `t${i}` } });
    }
    const all = (await call<any>("event.list")).events;
    expect(all).toHaveLength(100);
    expect(all[0].id).toBe("ev119"); // newest first
    const cron = (await call<any>("event.list", { source: "cron", limit: 5 })).events;
    expect(cron.map((e: any) => e.id)).toEqual(["ev119", "ev117", "ev115", "ev113", "ev111"]);
    const page = (await call<any>("event.list", { before: all[99].ts, limit: 50 })).events;
    expect(page).toHaveLength(20);
    expect(page[0].id).toBe("ev19");
  });

  it("device.list and device.pairCode", async () => {
    const { call } = setup();
    expect((await call<any>("device.list")).devices[0].isLocal).toBe(true);
    const { code, expiresAt } = await call<any>("device.pairCode");
    expect(code).toMatch(/^\d{6}$/);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("bot.detectAgents tolerates a failing driver and appends opencode", async () => {
    const ok: DetectedAgent = { engine: "codex", command: "codex", version: "1.0", found: true };
    const { call } = setup(new Map([
      ["codex", driver("codex", async () => ok)],
      ["claude", driver("claude", async () => { throw new Error("spawn failed"); })],
    ]));
    const { agents } = await call<any>("bot.detectAgents");
    expect(agents).toEqual([ok, { engine: "claude", command: "claude", found: false }, { engine: "opencode", command: "opencode", found: false }]);
  });

  it("bot.detectAgents runs the real opencode probe without throwing", async () => {
    const hub = createHub({ dataDir: "unused" });
    const { agents } = await createMiscHandlers({ hub, drivers: new Map() })["bot.detectAgents"]!({});
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ engine: "opencode", command: "opencode" });
    expect(typeof agents[0]!.found).toBe("boolean");
  });

  it("bot.add validates kind against drivers and commits bot.added", async () => {
    const { hub, call } = setup(new Map([["codex", driver("codex", async () => ({ engine: "codex", command: "codex", found: true }))]]));
    const pushes: string[] = [];
    hub.subscribe((p) => pushes.push(p.push.kind));

    const { bot } = await call<any>("bot.add", { name: " 小新 ", kind: "codex", color: "rose" });
    expect(bot).toMatchObject({ name: "小新", kind: "codex", engineLabel: "Codex", color: "rose", status: "idle" });
    expect(hub.model.bots[bot.id]).toEqual(bot);
    expect(pushes).toEqual(["bot.added"]);

    await expect(call("bot.add", { name: "x", kind: "claude" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(call("bot.add", { name: "x", kind: "main" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(call("bot.add", { name: "  ", kind: "codex" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(call("bot.add", { name: "小新", kind: "codex" })).rejects.toMatchObject({ code: "conflict" });
  });
});
