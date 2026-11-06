import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { DriverEvent, DriverSession } from "../../core/contracts";
import { createClaudeDriver } from "./index";
import type { ProcLike, SpawnFn } from "./index";

// ───────────── fake claude process ─────────────

class FakeProc extends EventEmitter implements ProcLike {
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: Array<Record<string, any>> = [];
  stdinEnded = false;
  killed = false;
  /** Close right after stdin ends, like the real CLI. */
  closeOnEnd = true;
  stdin = {
    write: (s: string) => {
      for (const l of s.split("\n").filter(Boolean)) this.written.push(JSON.parse(l));
      return true;
    },
    end: () => {
      this.stdinEnded = true;
      if (this.closeOnEnd) setImmediate(() => this.emit("close", 0));
    },
    on: () => undefined,
  };
  kill() {
    this.killed = true;
    setImmediate(() => this.emit("close", null));
  }
  emitMsg(o: unknown) {
    this.stdout.write(`${JSON.stringify(o)}\n`);
  }
  user() {
    return this.written.filter((w) => w.type === "user");
  }
}

function harness() {
  const procs: FakeProc[] = [];
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const spawn: SpawnFn = (command, args, opts) => {
    const p = new FakeProc();
    procs.push(p);
    calls.push({ command, args, cwd: opts.cwd });
    return p;
  };
  const driver = createClaudeDriver({ command: "claude-fake", spawn, closeGraceMs: 50 });
  return { driver, procs, calls };
}

function reader(s: DriverSession) {
  const it = s.events[Symbol.asyncIterator]();
  const seen: DriverEvent[] = [];
  return {
    seen,
    async until(pred: (e: DriverEvent) => boolean): Promise<DriverEvent[]> {
      const out: DriverEvent[] = [];
      for (;;) {
        const r = await it.next();
        if (r.done) return out;
        out.push(r.value);
        seen.push(r.value);
        if (pred(r.value)) return out;
      }
    },
    async rest(): Promise<DriverEvent[]> {
      const out: DriverEvent[] = [];
      for (;;) {
        const r = await it.next();
        if (r.done) return out;
        out.push(r.value);
      }
    },
  };
}
const isEnd = (e: DriverEvent) => e.t === "turn_end";

// ───────────── canned messages (shapes taken from a real claude 2.1.314 run) ─────────────

const stream = (event: unknown) => ({ type: "stream_event", event, parent_tool_use_id: null, session_id: "s" });
const textMsg = (id: string, text: string, uuid = "u-" + id) => ({
  type: "assistant", uuid, parent_tool_use_id: null, message: { id, role: "assistant", content: [{ type: "text", text }] },
});
const toolUse = (id: string, name: string, input: unknown, uuid = "u-" + id) => ({
  type: "assistant", uuid, parent_tool_use_id: null,
  message: { id: "m-" + id, role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (id: string, content: unknown, isError = false) => ({
  type: "user", parent_tool_use_id: null,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
const result = (extra: Record<string, unknown> = {}) => ({
  type: "result", subtype: "success", is_error: false, result: "OK", total_cost_usd: 0.35,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 },
  model_usage_since_last_result: { m: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 100, costUSD: 0.35 } },
  ...extra,
});

describe("claude driver: process setup", () => {
  it("starts a new session with a generated session id and writes the prompt", async () => {
    const { driver, procs, calls } = harness();
    const s = await driver.start({ cwd: "/work", prompt: "你好", model: "sonnet" });
    expect(calls[0]!.command).toBe("claude-fake");
    expect(calls[0]!.cwd).toBe("/work");
    const a = calls[0]!.args;
    expect(a).toEqual(expect.arrayContaining(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", "sonnet"]));
    expect(a[a.indexOf("--session-id") + 1]).toBe(s.nativeId);
    expect(procs[0]!.user()[0]!.message.content[0].text).toBe("你好");
    expect(s.caps).toEqual({ steer: true, fork: true, interrupt: true, approvals: true });
    await s.close();
  });

  it("resumes with --resume and keeps the native id", async () => {
    const { driver, calls } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "go on", resumeNativeId: "abc-123" });
    expect(s.nativeId).toBe("abc-123");
    const a = calls[0]!.args;
    expect(a[a.indexOf("--resume") + 1]).toBe("abc-123");
    expect(a).not.toContain("--session-id");
    await s.close();
  });
});

describe("claude driver: event mapping", () => {
  it("maps streamed text and result to text_delta / text_done / turn_end with per-turn usage", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "只回复 OK" });
    const r = reader(s);
    const p = procs[0]!;
    p.emitMsg({ type: "system", subtype: "init", session_id: "s" });
    p.emitMsg(stream({ type: "message_start", message: { id: "m1" } }));
    p.emitMsg(stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    p.emitMsg(stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "O" } }));
    p.emitMsg(stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "K" } }));
    p.emitMsg(textMsg("m1", "OK")); // already streamed: must not be duplicated
    p.emitMsg(stream({ type: "content_block_stop", index: 0 }));
    p.emitMsg(result());
    const ev = await r.until(isEnd);
    expect(ev).toEqual([
      { t: "turn_start", turn: 1 },
      { t: "text_delta", delta: "O" },
      { t: "text_delta", delta: "K" },
      { t: "text_done" },
      { t: "turn_end", status: "completed", usage: { tokens: 115, costUsd: 0.35 } },
    ]);
    await s.close();
  });

  it("emits un-streamed assistant text once when partial messages are absent", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    const r = reader(s);
    procs[0]!.emitMsg(textMsg("m9", "直接文本"));
    procs[0]!.emitMsg(result());
    expect(await r.until(isEnd)).toEqual([
      { t: "turn_start", turn: 1 },
      { t: "text_delta", delta: "直接文本" },
      { t: "text_done" },
      { t: "turn_end", status: "completed", usage: { tokens: 115, costUsd: 0.35 } },
    ]);
    await s.close();
  });

  it("maps streamed thinking blocks to thinking_delta / thinking_done before the answer", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "想一想" });
    const r = reader(s);
    const p = procs[0]!;
    p.emitMsg(stream({ type: "message_start", message: { id: "m1" } }));
    p.emitMsg(stream({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    p.emitMsg(stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "先看" } }));
    p.emitMsg(stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "回调" } }));
    p.emitMsg(stream({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }));
    p.emitMsg({ type: "assistant", uuid: "u-t", parent_tool_use_id: null, message: { id: "m1", role: "assistant", content: [{ type: "thinking", thinking: "先看回调", signature: "sig" }] } });
    p.emitMsg(stream({ type: "content_block_stop", index: 0 }));
    p.emitMsg(stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }));
    p.emitMsg(stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "好" } }));
    p.emitMsg(stream({ type: "content_block_stop", index: 1 }));
    p.emitMsg(result());
    expect(await r.until(isEnd)).toEqual([
      { t: "turn_start", turn: 1 },
      { t: "thinking_delta", delta: "先看" },
      { t: "thinking_delta", delta: "回调" },
      { t: "thinking_done" },
      { t: "text_delta", delta: "好" },
      { t: "text_done" },
      { t: "turn_end", status: "completed", usage: { tokens: 115, costUsd: 0.35 } },
    ]);
    await s.close();
  });

  it("emits un-streamed thinking once when partial messages are absent", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    const r = reader(s);
    procs[0]!.emitMsg({ type: "assistant", uuid: "u-9", parent_tool_use_id: null, message: { id: "m9", role: "assistant", content: [{ type: "thinking", thinking: "直接思考" }, { type: "thinking", thinking: "" }] } });
    procs[0]!.emitMsg(result());
    expect(await r.until(isEnd)).toEqual([
      { t: "turn_start", turn: 1 },
      { t: "thinking_delta", delta: "直接思考" },
      { t: "thinking_done" },
      { t: "turn_end", status: "completed", usage: { tokens: 115, costUsd: 0.35 } },
    ]);
    await s.close();
  });

  it("maps tool_use + tool_result: Read=read, Bash=command, Edit/Write=edit (+diff)", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/work", prompt: "x" });
    const r = reader(s);
    const p = procs[0]!;
    p.emitMsg(toolUse("t1", "Read", { file_path: "/work/src/a.ts" }));
    p.emitMsg(toolResult("t1", "file body…"));
    p.emitMsg(toolUse("t2", "Bash", { command: "pnpm test\necho hi" }));
    p.emitMsg(toolResult("t2", [{ type: "text", text: "3 passed\nShell cwd was reset to /work" }]));
    p.emitMsg(toolUse("t3", "Edit", { file_path: "/work/src/a.ts", old_string: "a\nb", new_string: "c" }));
    p.emitMsg(toolResult("t3", "The file has been updated"));
    p.emitMsg(toolUse("t4", "Write", { file_path: "/work/new.txt", content: "x\ny\nz" }));
    p.emitMsg(toolResult("t4", "created", true));
    p.emitMsg(toolUse("t5", "Grep", { pattern: "foo" }));
    p.emitMsg(toolResult("t5", "a.ts:1"));
    p.emitMsg(result());
    const ev = await r.until(isEnd);
    const tools = ev.filter((e) => e.t === "tool" || e.t === "diff");
    expect(tools).toEqual([
      { t: "tool", tool: "read", kind: "read", label: "src/a.ts", ok: true },
      { t: "tool", tool: "bash", kind: "command", label: "pnpm test", ok: true, output: "3 passed" },
      { t: "tool", tool: "edit", kind: "edit", label: "src/a.ts", ok: true },
      { t: "diff", files: [{ path: "src/a.ts", additions: 1, deletions: 2, patch: expect.stringContaining("-a\n-b\n+c") }] },
      { t: "tool", tool: "edit", kind: "edit", label: "new.txt", ok: false, output: "created" }, // failed: no diff
      { t: "tool", tool: "grep", kind: "other", label: "foo", ok: true, output: "a.ts:1" },
    ]);
    await s.close();
  });

  it("maps a failed result and ignores sub-agent partials", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    const r = reader(s);
    procs[0]!.emitMsg({ ...stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "sub" } }), parent_tool_use_id: "t" });
    procs[0]!.emitMsg(result({ subtype: "error_max_turns", is_error: true, result: "" }));
    expect(await r.until(isEnd)).toEqual([
      { t: "turn_start", turn: 1 },
      { t: "turn_end", status: "failed", error: "error_max_turns", usage: { tokens: 115, costUsd: 0.35 } },
    ]);
    await s.close();
  });

  it("starts turn 2 lazily on the next activity and falls back to differencing cumulative usage", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "one" });
    const r = reader(s);
    const p = procs[0]!;
    const cumulative = (cost: number, out: number) =>
      result({ model_usage_since_last_result: undefined, total_cost_usd: cost, usage: { input_tokens: 0, output_tokens: out } });
    p.emitMsg(cumulative(0.1, 10));
    await r.until(isEnd);
    await s.send("two", "normal");
    p.emitMsg(textMsg("m2", "hi"));
    p.emitMsg(cumulative(0.25, 30));
    const ev = await r.until(isEnd);
    expect(ev[0]).toEqual({ t: "turn_start", turn: 2 });
    expect(ev.at(-1)).toEqual({ t: "turn_end", status: "completed", usage: { tokens: 20, costUsd: 0.15 } });
    await s.close();
  });
});

describe("claude driver: approvals", () => {
  const ask = (id: string, tool: string, input: unknown, extra: Record<string, unknown> = {}) => ({
    type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: tool, input, tool_use_id: "tu", ...extra },
  });

  it("turns can_use_tool into an approval and answers allow/deny", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    const r = reader(s);
    const p = procs[0]!;
    p.emitMsg(ask("r1", "Bash", { command: "rm -rf build" }, { description: "删除构建目录" }));
    p.emitMsg(ask("r2", "Write", { file_path: "/w/a.txt", content: "x" }));
    p.emitMsg(ask("r3", "Read", { file_path: "/w/a.txt" }));
    const ev = await r.until((e) => e.t === "approval" && e.requestId === "r3");
    expect(ev.filter((e) => e.t === "approval")).toEqual([
      { t: "approval", requestId: "r1", title: "运行命令：rm -rf build", detail: "删除构建目录", risk: "high" },
      { t: "approval", requestId: "r2", title: "修改文件：a.txt", risk: "medium" },
      { t: "approval", requestId: "r3", title: "读取文件：a.txt", risk: "low" },
    ]);

    await s.resolveApproval("r1", true);
    await s.resolveApproval("r2", false);
    await s.resolveApproval("nope", true); // unknown ids are ignored
    const replies = p.written.filter((w) => w.type === "control_response").map((w) => w.response);
    expect(replies).toEqual([
      { subtype: "success", request_id: "r1", response: { behavior: "allow", updatedInput: { command: "rm -rf build" } } },
      { subtype: "success", request_id: "r2", response: { behavior: "deny", message: expect.any(String) } },
    ]);
    await s.close();
  });

  it("drops an approval the engine cancelled", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    const r = reader(s);
    const p = procs[0]!;
    p.emitMsg(ask("r1", "Bash", { command: "ls" }));
    await r.until((e) => e.t === "approval");
    p.emitMsg({ type: "control_cancel_request", request_id: "r1" });
    p.emitMsg(result());
    await r.until(isEnd);
    await s.resolveApproval("r1", true);
    expect(p.written.some((w) => w.type === "control_response")).toBe(false);
    await s.close();
  });

  it("answers unsupported control requests with an error", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    procs[0]!.emitMsg({ type: "control_request", request_id: "h1", request: { subtype: "hook_callback" } });
    await new Promise((res) => setTimeout(res, 20));
    expect(procs[0]!.written.find((w) => w.type === "control_response")!.response).toMatchObject({ subtype: "error", request_id: "h1" });
    await s.close();
  });
});

describe("claude driver: steer / queue / interrupt", () => {
  it("steer during a turn is a priority:next user message plus steer_applied", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "go" });
    const r = reader(s);
    await s.send("改用 vitest", "steer");
    const [, steered] = procs[0]!.user();
    expect(steered).toMatchObject({ priority: "next", message: { content: [{ text: "改用 vitest" }] } });
    expect(await r.until((e) => e.t === "steer_applied")).toEqual([{ t: "turn_start", turn: 1 }, { t: "steer_applied", text: "改用 vitest" }]);
    await s.close();
  });

  it("queue during a turn is priority:later; when idle both degrade to a plain message", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "go" });
    const r = reader(s);
    const p = procs[0]!;
    await s.send("later pls", "queue");
    p.emitMsg(result());
    await r.until(isEnd);
    await s.send("idle steer", "steer");
    await s.send("idle queue", "queue");
    const users = p.user();
    expect(users[1]!.priority).toBe("later");
    expect(users[2]!.priority).toBeUndefined();
    expect(users[3]!.priority).toBeUndefined();
    await s.close();
  });

  it("interrupt sends a control request and reports the turn as interrupted", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "go" });
    const r = reader(s);
    const p = procs[0]!;
    await s.interrupt();
    expect(p.written.find((w) => w.type === "control_request")!.request).toEqual({ subtype: "interrupt" });
    p.emitMsg(result({ subtype: "error_during_execution", is_error: true, result: "aborted" }));
    const ev = await r.until(isEnd);
    expect(ev.at(-1)).toMatchObject({ t: "turn_end", status: "interrupted" });
    expect((ev.at(-1) as { error?: string }).error).toBeUndefined();
    // idle interrupt is a no-op
    const before = p.written.length;
    await s.interrupt();
    expect(p.written.length).toBe(before);
    await s.close();
  });

  it("send(mode=interrupt) interrupts first, then delivers the message", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "go" });
    await s.send("停，换方案", "interrupt");
    const kinds = procs[0]!.written.map((w) => (w.type === "user" ? `user:${w.message.content[0].text}` : w.request?.subtype));
    expect(kinds).toEqual(["user:go", "interrupt", "user:停，换方案"]);
    await s.close();
  });
});

describe("claude driver: fork", () => {
  it("forks at the end of a turn using that turn's last assistant message", async () => {
    const { driver, procs, calls } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "t1", model: "opus" });
    const r = reader(s);
    const p = procs[0]!;
    p.emitMsg(textMsg("a1", "first", "uuid-turn1"));
    p.emitMsg(result());
    await r.until(isEnd);
    await s.send("t2", "normal");
    p.emitMsg(textMsg("a2", "second", "uuid-turn2"));
    p.emitMsg(result());
    await r.until(isEnd);

    const f = await s.fork(1);
    const a = calls[1]!.args;
    expect(f.nativeId).not.toBe(s.nativeId);
    expect(a[a.indexOf("--resume") + 1]).toBe(s.nativeId);
    expect(a).toContain("--fork-session");
    expect(a[a.indexOf("--resume-session-at") + 1]).toBe("uuid-turn1");
    expect(a[a.indexOf("--session-id") + 1]).toBe(f.nativeId);
    expect(a[a.indexOf("--model") + 1]).toBe("opus");
    expect(procs[1]!.user()).toHaveLength(0); // no prompt is sent on fork

    // the fork continues numbering after the cut point
    const fr = reader(f);
    await f.send("alt", "normal");
    procs[1]!.emitMsg(textMsg("b1", "alt-reply", "uuid-fork"));
    procs[1]!.emitMsg(result());
    expect((await fr.until(isEnd))[0]).toEqual({ t: "turn_start", turn: 2 });

    // unknown cut point -> whole history, and an explicit cwd is honoured
    const whole = await s.fork(9, { cwd: "/other" });
    expect(calls[2]!.cwd).toBe("/other");
    expect(calls[2]!.args).not.toContain("--resume-session-at");
    await Promise.all([s.close(), f.close(), whole.close()]);
  });
});

describe("claude driver: lifecycle", () => {
  it("reports a failed turn when the process dies mid-turn, with stderr context", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    const r = reader(s);
    procs[0]!.stderr.write("boom: not logged in\n");
    await new Promise((res) => setTimeout(res, 10));
    procs[0]!.emit("close", 1);
    const ev = await r.rest();
    expect(ev[0]).toEqual({ t: "turn_start", turn: 1 });
    expect(ev[1]).toMatchObject({ t: "turn_end", status: "failed", error: expect.stringContaining("not logged in") });
    await expect(s.send("again", "normal")).rejects.toThrow();
  });

  it("reports spawn errors as a failed turn", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    const r = reader(s);
    procs[0]!.emit("error", new Error("spawn claude ENOENT"));
    const ev = await r.rest();
    expect(ev.at(-1)).toMatchObject({ t: "turn_end", status: "failed", error: expect.stringContaining("ENOENT") });
  });

  it("close() ends stdin, ends the event stream and interrupts a running turn", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    const r = reader(s);
    await s.close();
    expect(procs[0]!.stdinEnded).toBe(true);
    expect(procs[0]!.written.some((w) => w.request?.subtype === "interrupt")).toBe(true);
    expect((await r.rest()).at(-1)).toMatchObject({ t: "turn_end", status: "interrupted" });
  });

  it("close() kills a process that ignores stdin EOF", async () => {
    const { driver, procs } = harness();
    const s = await driver.start({ cwd: "/w", prompt: "x" });
    procs[0]!.closeOnEnd = false;
    await s.close();
    expect(procs[0]!.killed).toBe(true);
  });
});

describe("claude driver: detect", () => {
  it("reports found:false for a missing executable", async () => {
    const d = createClaudeDriver({ command: "definitely-not-a-real-binary-xyz" });
    expect(await d.detect()).toEqual({ engine: "claude", command: "definitely-not-a-real-binary-xyz", found: false });
  });

  it("parses the version from `--version` output", async () => {
    const d = createClaudeDriver({ command: process.execPath }); // `node --version` -> v22.x.y
    const r = await d.detect();
    expect(r).toMatchObject({ engine: "claude", found: true });
    expect(r.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
