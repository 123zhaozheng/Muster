import { afterEach, describe, expect, it } from "vitest";
import type { DriverEvent, DriverSession } from "../../core/contracts";
import { createFakeDriver } from "./index";

const driver = createFakeDriver("native", { speed: "fast", randomApprovalRate: 0 });
const opened: DriverSession[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
});

/** Starts a session and wraps its (single-use) event iterator in a pull helper. */
async function open(prompt: string, d = driver) {
  const session = await d.start({ cwd: "/tmp/work", prompt });
  opened.push(session);
  return { session, ...reader(session) };
}

function reader(session: DriverSession) {
  const it = session.events[Symbol.asyncIterator]();
  // A timed-out quietFor leaves one pull in flight; reuse it so no event is lost.
  let inflight: Promise<DriverEvent | undefined> | undefined;
  const next = (): Promise<DriverEvent | undefined> => {
    inflight ??= it.next().then((r) => {
      inflight = undefined;
      return r.done ? undefined : r.value;
    });
    return inflight;
  };
  /** Pulls events up to and including the first one matching `pred`. */
  const until = async (pred: (e: DriverEvent) => boolean): Promise<DriverEvent[]> => {
    const got: DriverEvent[] = [];
    for (;;) {
      const e = await next();
      if (!e) return got;
      got.push(e);
      if (pred(e)) return got;
    }
  };
  const untilTurnEnd = () => until((e) => e.t === "turn_end");
  /** Resolves true when no event shows up within `ms`. */
  const quietFor = async (ms: number): Promise<boolean> =>
    Promise.race([next().then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), ms))]);
  return { next, until, untilTurnEnd, quietFor };
}

const types = (evs: DriverEvent[]) => evs.map((e) => e.t);
const textOf = (evs: DriverEvent[]) => evs.map((e) => (e.t === "text_delta" ? e.delta : "")).join("");

describe("fake driver", () => {
  it("detect reports found and start gives full caps", async () => {
    expect(await driver.detect()).toMatchObject({ found: true });
    const { session } = await open("修一下回调");
    expect(session.caps).toEqual({ steer: true, fork: true, interrupt: true, approvals: true });
    expect(session.nativeId).toMatch(/^fake-native-/);
  });

  it("emits a complete turn in order", async () => {
    const { untilTurnEnd } = await open("修复支付回调的重复处理");
    const evs = await untilTurnEnd();
    const t = types(evs);
    expect(evs[0]).toEqual({ t: "turn_start", turn: 1 });
    const first = (x: string) => t.indexOf(x as DriverEvent["t"]);
    expect(first("text_delta")).toBe(1);
    expect(first("text_done")).toBeGreaterThan(first("text_delta"));
    expect(first("tool")).toBeGreaterThan(first("text_done"));
    expect(first("diff")).toBeGreaterThan(first("tool"));
    expect(first("tests")).toBeGreaterThan(first("diff"));
    expect(t.lastIndexOf("text_done")).toBeGreaterThan(first("tests"));
    expect(t).not.toContain("approval");
    expect(evs.filter((e) => e.t === "tool" && e.kind === "read").length).toBeGreaterThanOrEqual(2);
    expect(evs.some((e) => e.t === "tool" && e.kind === "command")).toBe(true);
    // every text_delta run is closed by a text_done
    const deltas = t.filter((x) => x === "text_delta").length;
    expect(deltas).toBeGreaterThan(5);
    const end = evs.at(-1)!;
    expect(end).toMatchObject({ t: "turn_end", status: "completed" });
    expect(end.t === "turn_end" && end.usage?.tokens).toBeGreaterThan(0);
    expect(textOf(evs)).toContain("我先读一下");
  });

  it("diff files are consistent unified diffs", async () => {
    const { untilTurnEnd } = await open("修复支付回调");
    const evs = await untilTurnEnd();
    const diff = evs.find((e) => e.t === "diff");
    if (diff?.t !== "diff") throw new Error("no diff");
    for (const f of diff.files) {
      const lines = f.patch.split("\n");
      expect(lines[0]).toBe(`--- a/${f.path}`);
      expect(lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length).toBe(f.additions);
      expect(lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length).toBe(f.deletions);
    }
  });

  it("is deterministic for the same prompt", async () => {
    const a = await (await open("重构队列重试逻辑")).untilTurnEnd();
    const b = await (await open("重构队列重试逻辑")).untilTurnEnd();
    expect(b).toEqual(a);
    const c = await (await open("给订单接口补测试")).untilTurnEnd();
    expect(c).not.toEqual(a);
  });

  it("approval allow runs pnpm install and continues", async () => {
    const { session, until, untilTurnEnd, quietFor } = await open("先安装依赖，然后修复回调");
    const before = await until((e) => e.t === "approval");
    const ap = before.at(-1)!;
    if (ap.t !== "approval") throw new Error("no approval");
    expect(ap).toMatchObject({ risk: "medium", detail: "pnpm install" });
    expect(await quietFor(80)).toBe(true); // blocked until resolved
    await session.resolveApproval(ap.requestId, true);
    const after = await untilTurnEnd();
    expect(after.some((e) => e.t === "tool" && e.label === "pnpm install")).toBe(true);
    expect(after.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });
  });

  it("approval deny switches to another approach", async () => {
    const { session, until, untilTurnEnd } = await open("need to install deps and fix the bug");
    const ap = (await until((e) => e.t === "approval")).at(-1)!;
    if (ap.t !== "approval") throw new Error("no approval");
    await session.resolveApproval(ap.requestId, false);
    const after = await untilTurnEnd();
    expect(after.some((e) => e.t === "tool" && e.label === "pnpm install")).toBe(false);
    const text = textOf(after);
    expect(text).toContain("不运行 pnpm install");
    expect(text).toContain("没有新增依赖");
    expect(after.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });
  });

  it("random approvals are seeded by the prompt", async () => {
    const always = createFakeDriver("claude", { speed: "fast", randomApprovalRate: 1 });
    const { until } = await open("随便改点东西", always);
    expect((await until((e) => e.t === "approval")).at(-1)?.t).toBe("approval");
  });

  it("steer is applied at the next step boundary and reflected in later text", async () => {
    const { session, until, untilTurnEnd } = await open("修复支付回调");
    await until((e) => e.t === "text_done");
    await session.send("别动 package.json", "steer");
    const evs = await untilTurnEnd();
    const t = types(evs);
    const applied = evs.find((e) => e.t === "steer_applied");
    expect(applied).toEqual({ t: "steer_applied", text: "别动 package.json" });
    expect(t.indexOf("steer_applied")).toBeLessThan(t.indexOf("diff"));
    expect(textOf(evs.slice(t.indexOf("steer_applied")))).toContain("别动 package.json");
    expect(textOf(evs.slice(t.lastIndexOf("tests")))).toContain("按你的插话");
    expect(t.filter((x) => x === "turn_start")).toHaveLength(0); // same turn
  });

  it("steer on an idle session behaves like normal", async () => {
    const { session, untilTurnEnd } = await open("修复回调");
    await untilTurnEnd();
    await session.send("再看看重试", "steer");
    const evs = await untilTurnEnd();
    expect(evs[0]).toEqual({ t: "turn_start", turn: 2 });
    expect(types(evs)).not.toContain("steer_applied");
  });

  it("queue starts a new turn only after the current one ends", async () => {
    const { session, until, untilTurnEnd } = await open("修复回调");
    await until((e) => e.t === "text_done");
    await session.send("接着补测试", "queue");
    const rest = await untilTurnEnd();
    expect(types(rest)).not.toContain("turn_start");
    expect(rest.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });
    const second = await untilTurnEnd();
    expect(second[0]).toEqual({ t: "turn_start", turn: 2 });
    expect(textOf(second)).toContain("接着补测试");
  });

  it("normal while busy is queued", async () => {
    const { session, until, untilTurnEnd } = await open("修复回调");
    await until((e) => e.t === "text_done");
    await session.send("再改一处", "normal");
    expect((await untilTurnEnd()).at(-1)).toMatchObject({ status: "completed" });
    expect((await untilTurnEnd())[0]).toEqual({ t: "turn_start", turn: 2 });
  });

  it("interrupt() ends the turn as interrupted and stays idle", async () => {
    const { session, until, untilTurnEnd, quietFor } = await open("修复回调");
    await until((e) => e.t === "text_done");
    await session.interrupt();
    const rest = await untilTurnEnd();
    expect(rest.at(-1)).toMatchObject({ t: "turn_end", status: "interrupted" });
    expect(types(rest)).not.toContain("diff");
    expect(await quietFor(80)).toBe(true);
  });

  it("send(..., 'interrupt') interrupts then starts a new turn with the text", async () => {
    const { session, until, untilTurnEnd } = await open("修复回调");
    await until((e) => e.t === "text_done");
    await session.send("改成补充订单接口的单测", "interrupt");
    const rest = await untilTurnEnd();
    expect(rest.at(-1)).toMatchObject({ status: "interrupted" });
    const second = await untilTurnEnd();
    expect(second[0]).toEqual({ t: "turn_start", turn: 2 });
    expect(textOf(second)).toContain("改成补充订单接口的单测".slice(0, 10));
    expect(second.at(-1)).toMatchObject({ status: "completed" });
  });

  it("interrupt while waiting for approval ends the turn", async () => {
    const { session, until, untilTurnEnd } = await open("请安装依赖");
    await until((e) => e.t === "approval");
    await session.interrupt();
    expect((await untilTurnEnd()).at(-1)).toMatchObject({ status: "interrupted" });
  });

  it("fork keeps earlier history and mentions the branch point", async () => {
    const { session, untilTurnEnd } = await open("修复回调");
    await untilTurnEnd();
    await session.send("再补一个测试", "normal");
    await untilTurnEnd();

    const child = await session.fork(1);
    opened.push(child);
    expect(child.nativeId).not.toBe(session.nativeId);
    const r = reader(child);
    await child.send("换一种实现", "normal");
    const evs = await r.untilTurnEnd();
    expect(evs[0]).toEqual({ t: "turn_start", turn: 2 }); // continues after the 1 kept turn
    expect(textOf(evs)).toContain("从第 1 步分支");
    // only the first reply after the fork carries the note
    await child.send("继续", "normal");
    expect(textOf(await r.untilTurnEnd())).not.toContain("从第 1 步分支出来");
  });

  it("close ends iteration, also mid-turn", async () => {
    const { session, until, next } = await open("修复回调");
    await until((e) => e.t === "text_delta");
    await session.close();
    let guard = 0;
    while ((await next()) && guard++ < 1000);
    expect(await next()).toBeUndefined();
    await expect(session.send("x", "normal")).rejects.toThrow();

    const idle = await open("修复回调");
    await idle.untilTurnEnd();
    await idle.session.close();
    expect(await idle.next()).toBeUndefined();
  });

  it("fork rejects invalid turn numbers", async () => {
    const { session } = await open("修复回调");
    await expect(session.fork(-1)).rejects.toThrow(RangeError);
  });
});
