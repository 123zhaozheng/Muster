import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DriverEvent, DriverSession } from "../../core/contracts";
import { createCodexDriver } from "./index";
import { toDiffFiles } from "./map";

const FAKE = fileURLToPath(new URL("./__fixtures__/fake-app-server.mjs", import.meta.url));

let dir: string;
let logPath: string;
const open: DriverSession[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "muster-codex-"));
  logPath = join(dir, "rpc.log");
  process.env.FAKE_LOG = logPath;
});

afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
  delete process.env.FAKE_LOG;
  rmSync(dir, { recursive: true, force: true });
});

const driver = () => createCodexDriver({ command: process.execPath, args: [FAKE], requestTimeoutMs: 10_000 });

async function start(prompt: string, extra: { resumeNativeId?: string } = {}) {
  const s = await driver().start({ cwd: dir, prompt, ...extra });
  open.push(s);
  return s;
}

/** Pulls events one by one with a timeout so a hung test fails instead of hanging. */
function reader(s: DriverSession) {
  const it = s.events[Symbol.asyncIterator]();
  const next = async (): Promise<DriverEvent | null> => {
    const r = await Promise.race([
      it.next(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("等待事件超时")), 8000).unref()),
    ]);
    return r.done ? null : r.value;
  };
  const until = async (pred: (e: DriverEvent) => boolean): Promise<DriverEvent[]> => {
    const got: DriverEvent[] = [];
    for (;;) {
      const e = await next();
      if (!e) throw new Error("事件流提前结束：" + JSON.stringify(got));
      got.push(e);
      if (pred(e)) return got;
    }
  };
  const untilTurnEnd = () => until((e) => e.t === "turn_end");
  return { next, until, untilTurnEnd };
}

const rpcLog = () => readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("codex driver (fake app-server)", () => {
  it("握手、thread/start、流式文本与 turn_end(含 token)", async () => {
    const s = await start("hello");
    expect(s.nativeId).toBe("thr_1");
    expect(s.caps).toEqual({ steer: true, fork: true, interrupt: true, approvals: true });
    const evs = await reader(s).untilTurnEnd();
    expect(evs).toEqual([
      { t: "turn_start", turn: 1 },
      { t: "text_delta", delta: "你好，" },
      { t: "text_delta", delta: "世界" },
      { t: "text_done" },
      { t: "turn_end", status: "completed", usage: { tokens: 100 } },
    ]);
    const log = rpcLog();
    expect(log.map((m) => m.method)).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
    expect(log[0].params.clientInfo.name).toBe("muster");
    expect(log[2].params).toMatchObject({ cwd: dir, approvalPolicy: "on-request", sandbox: "workspace-write" });
    expect(log[3].params).toMatchObject({ threadId: "thr_1", input: [{ type: "text", text: "hello" }] });
  });

  it("没有 delta 的 agentMessage 补发完整文本", async () => {
    const s = await start("nodelta");
    const evs = await reader(s).untilTurnEnd();
    expect(evs.filter((e) => e.t !== "turn_start")).toEqual([
      { t: "text_delta", delta: "整段回复" },
      { t: "text_done" },
      { t: "turn_end", status: "completed" },
    ]);
  });

  it("推理：摘要增量 -> thinking_delta（分段补空行，原文不重复），未流式的补发全文，空推理不出现", async () => {
    const s = await start("reason");
    const evs = await reader(s).untilTurnEnd();
    expect(evs.filter((e) => e.t !== "turn_start")).toEqual([
      { t: "thinking_delta", delta: "先读" },
      { t: "thinking_delta", delta: "代码" },
      { t: "thinking_delta", delta: "\n\n再改" },
      { t: "thinking_done" },
      { t: "thinking_delta", delta: "整段推理" },
      { t: "thinking_done" },
      { t: "text_delta", delta: "好了" },
      { t: "text_done" },
      { t: "turn_end", status: "completed" },
    ]);
  });

  it("工具事件：读 / 命令 / 文件改动与 diff", async () => {
    const s = await start("tools");
    const evs = await reader(s).untilTurnEnd();
    expect(evs).toEqual([
      { t: "turn_start", turn: 1 },
      { t: "tool", tool: "read", kind: "read", label: "/w/README.md", ok: true, output: "# hi" },
      { t: "tool", tool: "bash", kind: "command", label: "pnpm test", ok: false, output: "boom" },
      { t: "tool", tool: "edit", kind: "edit", label: "x.ts", ok: true },
      { t: "diff", files: [{ path: "x.ts", additions: 1, deletions: 1, patch: "@@\n-a\n+b\n" }] },
      { t: "turn_end", status: "completed" },
    ]);
  });

  it("命令审批：允许 -> accept", async () => {
    const s = await start("approve");
    const r = reader(s);
    const evs = await r.until((e) => e.t === "approval");
    const ap = evs.at(-1) as Extract<DriverEvent, { t: "approval" }>;
    expect(ap).toMatchObject({ title: "运行命令", risk: "high" });
    expect(ap.detail).toContain("rm -rf build");
    expect(ap.detail).toContain("清理构建产物");
    await s.resolveApproval(ap.requestId, true);
    const rest = await r.untilTurnEnd();
    expect(rest).toContainEqual({ t: "tool", tool: "bash", kind: "command", label: "rm -rf build", ok: true, output: "removed" });
    expect(rest).toContainEqual({ t: "text_delta", delta: "decision:accept" });
    expect(rpcLog().find((m) => m.id === ap.requestId && m.method === undefined).result).toEqual({ decision: "accept" });
  });

  it("命令审批：拒绝 -> decline", async () => {
    const s = await start("approve");
    const r = reader(s);
    const ap = (await r.until((e) => e.t === "approval")).at(-1) as Extract<DriverEvent, { t: "approval" }>;
    await s.resolveApproval(ap.requestId, false);
    const rest = await r.untilTurnEnd();
    expect(rest).toContainEqual({ t: "tool", tool: "bash", kind: "command", label: "rm -rf build", ok: false });
    expect(rpcLog().find((m) => m.id === ap.requestId && m.method === undefined).result).toEqual({ decision: "decline" });
  });

  it("文件审批：detail 带出文件清单，允许后产生 diff", async () => {
    const s = await start("edit");
    const r = reader(s);
    const ap = (await r.until((e) => e.t === "approval")).at(-1) as Extract<DriverEvent, { t: "approval" }>;
    expect(ap).toMatchObject({ title: "修改文件", risk: "medium" });
    expect(ap.detail).toContain("src/a.ts (+2 -1)");
    expect(ap.detail).toContain("src/b.ts (+2 -0)");
    await s.resolveApproval(ap.requestId, true);
    const rest = await r.untilTurnEnd();
    const diff = rest.find((e) => e.t === "diff") as Extract<DriverEvent, { t: "diff" }>;
    expect(diff.files.map((f) => [f.path, f.additions, f.deletions])).toEqual([["src/a.ts", 2, 1], ["src/b.ts", 2, 0]]);
    expect(diff.files[1]!.patch).toContain("+l1");
  });

  it("steer：携带 expectedTurnId，成功后 steer_applied", async () => {
    const s = await start("slow");
    const r = reader(s);
    await r.until((e) => e.t === "text_delta");
    await s.send("改用 pnpm", "steer");
    const rest = await r.untilTurnEnd();
    expect(rest[0]).toEqual({ t: "steer_applied", text: "改用 pnpm" });
    expect(rest).toContainEqual({ t: "text_delta", delta: "收到插话：改用 pnpm" });
    const steer = rpcLog().find((m) => m.method === "turn/steer");
    expect(steer.params).toMatchObject({ threadId: "thr_1", expectedTurnId: "turn_1" });
  });

  it("steer 被拒绝时降级为排队，并在本轮结束后另起一轮", async () => {
    const s = await start("slow");
    const r = reader(s);
    await r.until((e) => e.t === "text_delta");
    await s.send("reject me", "steer"); // fake rejects -> queued
    await s.interrupt();
    const first = await r.untilTurnEnd();
    expect(first.at(-1)).toEqual({ t: "turn_end", status: "interrupted" });
    expect(first.some((e) => e.t === "steer_applied")).toBe(false);
    const second = await r.untilTurnEnd();
    expect(second[0]).toEqual({ t: "turn_start", turn: 2 });
    const starts = rpcLog().filter((m) => m.method === "turn/start");
    expect(starts[1].params.input[0].text).toBe("reject me");
  });

  it("queue：运行中排队，本轮结束后自动开始下一轮", async () => {
    const s = await start("slow");
    const r = reader(s);
    await r.until((e) => e.t === "text_delta");
    await s.send("hello", "queue");
    await s.interrupt();
    await r.untilTurnEnd();
    const second = await r.untilTurnEnd();
    expect(second).toContainEqual({ t: "text_delta", delta: "你好，" });
    expect(second.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });
  });

  it("interrupt 模式：打断当前轮并以新输入开始下一轮", async () => {
    const s = await start("slow");
    const r = reader(s);
    await r.until((e) => e.t === "text_delta");
    await s.send("hello", "interrupt");
    const first = await r.untilTurnEnd();
    expect(first.at(-1)).toEqual({ t: "turn_end", status: "interrupted" });
    const intr = rpcLog().find((m) => m.method === "turn/interrupt");
    expect(intr.params).toEqual({ threadId: "thr_1", turnId: "turn_1" });
    const second = await r.untilTurnEnd();
    expect(second[0]).toEqual({ t: "turn_start", turn: 2 });
  });

  it("空闲时 send 直接开新一轮", async () => {
    const s = await start("hello");
    const r = reader(s);
    await r.untilTurnEnd();
    await s.send("hello", "steer");
    const evs = await r.untilTurnEnd();
    expect(evs[0]).toEqual({ t: "turn_start", turn: 2 });
  });

  it("失败的 turn 带错误信息", async () => {
    const s = await start("fail");
    const evs = await reader(s).untilTurnEnd();
    expect(evs.at(-1)).toEqual({ t: "turn_end", status: "failed", error: "模型不可用" });
  });

  it("进程意外退出：运行中的 turn 以 failed 结束并关闭事件流", async () => {
    const s = await start("crash");
    const r = reader(s);
    const evs = await r.untilTurnEnd();
    expect(evs.at(-1)).toMatchObject({ t: "turn_end", status: "failed" });
    expect(await r.next()).toBeNull();
  });

  it("fork：按轮次 id 调 thread/fork，新会话从该轮之后继续计数", async () => {
    const s = await start("hello");
    const r = reader(s);
    await r.untilTurnEnd();
    await s.send("hello", "normal");
    await r.untilTurnEnd(); // two turns done
    const f = await s.fork(1, { cwd: dir });
    open.push(f);
    expect(f.nativeId).toMatch(/^thr_fork_/);
    const fork = rpcLog().find((m) => m.method === "thread/fork");
    expect(fork.params).toMatchObject({ threadId: "thr_1", lastTurnId: "turn_1", cwd: dir });
    const fr = reader(f);
    await f.send("hello", "normal");
    const evs = await fr.untilTurnEnd();
    expect(evs[0]).toEqual({ t: "turn_start", turn: 2 });
    await expect(s.fork(9)).rejects.toThrow("不存在");
  });

  it("resume：thread/resume 恢复历史轮次，空 prompt 不开新轮", async () => {
    const s = await start("", { resumeNativeId: "thr_old" });
    expect(s.nativeId).toBe("thr_old");
    expect(rpcLog().map((m) => m.method)).toEqual(["initialize", "initialized", "thread/resume"]);
    const r = reader(s);
    await s.send("hello", "normal");
    expect((await r.untilTurnEnd())[0]).toEqual({ t: "turn_start", turn: 3 });
    const f = await s.fork(2);
    open.push(f);
    expect(rpcLog().find((m) => m.method === "thread/fork").params.lastTurnId).toBe("old_2");
  });

  it("close 结束事件流", async () => {
    const s = await start("slow");
    const r = reader(s);
    await r.until((e) => e.t === "text_delta");
    await s.close();
    expect(await r.next()).toBeNull();
    await expect(s.send("x", "normal")).rejects.toThrow();
  });

  it("detect：存在 / 不存在的命令", async () => {
    const found = await createCodexDriver({ command: process.execPath }).detect();
    expect(found).toMatchObject({ engine: "codex", found: true });
    expect(found.version).toMatch(/^\d+\.\d+\.\d+/);
    const missing = await createCodexDriver({ command: "definitely-not-a-codex-binary-xyz" }).detect();
    expect(missing).toMatchObject({ engine: "codex", found: false });
  });

  it("命令不存在时 start 报清晰错误", async () => {
    const d = createCodexDriver({ command: "definitely-not-a-codex-binary-xyz", requestTimeoutMs: 5000 });
    await expect(d.start({ cwd: dir, prompt: "x" })).rejects.toThrow(/codex app-server/);
  });
});

describe("toDiffFiles", () => {
  it("统计增删行", () => {
    const [f] = toDiffFiles([{ path: "a", kind: { type: "update", move_path: null }, diff: "--- a\n+++ b\n@@\n-x\n+y\n+z\n" }]);
    expect(f).toMatchObject({ additions: 2, deletions: 1 });
    const [d] = toDiffFiles([{ path: "gone", kind: { type: "delete" }, diff: "a\nb\n" }]);
    expect(d).toMatchObject({ additions: 0, deletions: 2 });
  });
});
