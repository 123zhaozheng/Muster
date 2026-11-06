import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Handlers } from "../core/contracts";
import { createHub } from "../core/hub";
import { createMiscHandlers } from "../handlers/misc";
import { HandlerError } from "../handlers/errors";
import { startServer, type RunningServer } from "./server";

let server: RunningServer | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await server?.close();
  server = undefined;
});

function connect(port: number, query = ""): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
    sockets.push(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

const next = (ws: WebSocket, pred: (m: any) => boolean = () => true): Promise<any> =>
  new Promise((resolve) => {
    const on = (d: Buffer) => {
      const m = JSON.parse(d.toString());
      if (pred(m)) {
        ws.off("message", on);
        resolve(m);
      }
    };
    ws.on("message", on);
  });

const call = (ws: WebSocket, method: string, params: unknown = {}, id = "r1") => {
  const p = next(ws, (m) => m.type === "res" && m.id === id);
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return p;
};

async function setup(opts: { token?: string; handlers?: Handlers } = {}) {
  const hub = createHub({ dataDir: "unused" });
  const handlers = opts.handlers ?? createMiscHandlers({ hub, drivers: new Map() });
  server = await startServer({ hub, handlers, port: 0, token: opts.token });
  return { hub, port: server.port };
}

describe("startServer", () => {
  it("serves /health on a real port and 404s elsewhere", async () => {
    const { port } = await setup();
    expect(port).toBeGreaterThan(0);
    expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });

  it("answers hub.snapshot and broadcasts pushes to every client", async () => {
    const { hub, port } = await setup();
    const a = await connect(port);
    const b = await connect(port);
    const snap = await call(a, "hub.snapshot");
    expect(snap.ok).toBe(true);
    expect(snap.result.bots.length).toBeGreaterThan(0);

    const pa = next(a, (m) => m.type === "push");
    const pb = next(b, (m) => m.type === "push");
    const bot = { ...snap.result.bots[0], status: "working" };
    hub.commit({ kind: "bot.updated", bot });
    for (const m of await Promise.all([pa, pb])) {
      expect(m.seq).toBe(1);
      expect(m.push.bot.status).toBe("working");
    }
  });

  it("maps errors: unsupported / bad_request / internal / coded errors", async () => {
    const handlers: Handlers = {
      "device.list": async () => {
        throw new Error("boom");
      },
      "trigger.list": async () => {
        throw new HandlerError("busy", "忙");
      },
    };
    const { port } = await setup({ handlers });
    const ws = await connect(port);

    expect((await call(ws, "nope")).error.code).toBe("unsupported");
    expect((await call(ws, "constructor")).error.code).toBe("unsupported");
    expect((await call(ws, "device.list")).error).toMatchObject({ code: "internal", message: "boom" });
    expect((await call(ws, "trigger.list")).error).toMatchObject({ code: "busy", message: "忙" });
    expect((await call(ws, "hub.snapshot", [1])).error.code).toBe("bad_request");

    const bad = next(ws, (m) => m.type === "res");
    ws.send("not json");
    expect((await bad).error.code).toBe("bad_request");
    const badShape = next(ws, (m) => m.type === "res" && m.id === "x");
    ws.send(JSON.stringify({ type: "req", id: "x" }));
    expect((await badShape).error.code).toBe("bad_request");
  });

  it("runs misc handlers over the wire (not_found, bot.add commits a push)", async () => {
    const hub = createHub({ dataDir: "unused" });
    const drivers = new Map([["codex" as const, { kind: "codex" as const, detect: async () => ({ engine: "codex" as const, command: "codex", found: true }), start: async () => { throw new Error("x"); } }]]);
    server = await startServer({ hub, handlers: createMiscHandlers({ hub, drivers, detectOpencode: async () => ({ engine: "opencode", command: "opencode", found: false }) }), port: 0 });
    const ws = await connect(server.port);

    expect((await call(ws, "thread.get", { threadId: "nope" })).error.code).toBe("not_found");
    const pushed = next(ws, (m) => m.type === "push");
    const added = await call(ws, "bot.add", { name: "新同学", kind: "codex" });
    expect(added.ok).toBe(true);
    expect((await pushed).push.kind).toBe("bot.added");
    expect(hub.model.bots[added.result.bot.id]?.name).toBe("新同学");
  });

  it("enforces the token with close code 4401", async () => {
    const { port } = await setup({ token: "s3cret" });
    const closed = (query: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
        sockets.push(ws);
        ws.once("close", (code) => resolve(code));
        ws.once("error", () => {});
      });
    expect(await closed("")).toBe(4401);
    expect(await closed("?token=wrong")).toBe(4401);

    const ws = await connect(port, "?token=s3cret");
    expect((await call(ws, "hub.snapshot")).ok).toBe(true);
  });

  it("rejects other paths and shuts down cleanly with clients connected", async () => {
    const { port } = await setup();
    const ws = await connect(port);
    const closed = new Promise((resolve) => ws.once("close", resolve));
    await server!.close();
    await closed;
    server = undefined;
    await expect(connect(port)).rejects.toBeDefined();
  });
});
