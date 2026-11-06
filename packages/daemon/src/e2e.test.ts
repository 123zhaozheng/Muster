/**
 * 后端端到端联调：真实 startDaemon（fake 驱动）+ ws 客户端，走完整剧本。
 * 剧本是顺序依赖的（每步用上一步的结果），所以用一个 describe 串行执行。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { MAIN_THREAD_ID } from "@muster/protocol";
import type { Methods, MethodName, ServerMessage, Snapshot, Task, TriggerRule } from "@muster/protocol";
import { applyPush, modelFromSnapshot, type HubModel } from "@muster/protocol/reducer";

process.env.MUSTER_FAKE_SPEED = "fast";
const { startDaemon } = await import("./app");

const TOKEN = "e2e-token";
type Daemon = Awaited<ReturnType<typeof startDaemon>>;

/** 极简客户端：请求/响应 + 用共享 reducer 维护本地模型，并检查 push 的 seq 连续。 */
class TestClient {
  model!: HubModel;
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
    c.ws.on("message", (d) => c.onMessage(JSON.parse(d.toString()) as ServerMessage));
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

  /** 轮询本地模型直到条件成立。 */
  async waitFor<T>(what: string, pick: (m: HubModel) => T | undefined | false, timeoutMs = 20000): Promise<T> {
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

describe("e2e: 完整剧本（fake 驱动）", () => {
  let dataDir: string;
  let daemon: Daemon | undefined;
  let c: TestClient;

  // 剧本中间结果
  let taskMa: Task; // 小码（steer 目标）
  let taskAke: Task; // 阿克（queue 目标）
  let forked: { task: Task; branchId: string };
  let cronRule: TriggerRule;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "muster-e2e-"));
    daemon = await startDaemon({ dataDir, port: 0, token: TOKEN, fake: true });
    c = await TestClient.connect(daemon.port);
  }, 30000);

  afterAll(async () => {
    c?.close();
    await daemon?.stop();
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  });

  /** 自动放行所有待审批（非无人值守的），返回已处理的 id。 */
  const allowedIds = new Set<string>();
  async function allowPending() {
    for (const ap of Object.values(c.model.approvals)) {
      if (ap.status === "pending" && !ap.unattended && !allowedIds.has(ap.id)) {
        allowedIds.add(ap.id);
        await c.request("approval.resolve", { approvalId: ap.id, decision: "allow" });
      }
    }
  }
  async function untilFinished(taskId: string, timeoutMs = 30000) {
    const t0 = Date.now();
    while (!isFinished(c.model.tasks[taskId])) {
      await allowPending();
      if (Date.now() - t0 > timeoutMs) throw new Error(`任务未结束: ${taskId} ${c.model.tasks[taskId]?.status}`);
      await new Promise((r) => setTimeout(r, 40));
    }
    return c.model.tasks[taskId]!;
  }

  it("1. snapshot：主 Bot、四个 Bot、本机设备", async () => {
    const snap: Snapshot = await c.request("hub.snapshot", {});
    expect(snap.bots.map((b) => b.name)).toEqual(expect.arrayContaining(["Pip", "小码", "阿克", "小探", "小文"]));
    expect(snap.threads.some((t) => t.id === MAIN_THREAD_ID)).toBe(true);
    expect(snap.devices.some((d) => d.isLocal)).toBe(true);
    expect(snap.recentEvents).toEqual([]);
  });

  it("2. 主线派发两件事 -> 两个 task 与两条 dispatch entry", async () => {
    await c.request("chat.send", {
      threadId: MAIN_THREAD_ID,
      text: "shop-api 里两件事：修支付回调 bug 交给小码，写退款接口交给阿克",
    });
    const tasks = await c.waitFor("两个任务", (m) => Object.keys(m.tasks).length >= 2 && Object.values(m.tasks));
    const ma = tasks.find((t) => t.botId === "bot-xiaoma");
    const ake = tasks.find((t) => t.botId === "bot-ake");
    expect(ma && ake).toBeTruthy();
    taskMa = ma!;
    taskAke = ake!;
    expect(taskMa.parentThreadId).toBe(MAIN_THREAD_ID);
    expect(taskMa.threadId).toBeTruthy();
    expect(taskMa.threadId).not.toBe(taskAke.threadId);

    const main = await c.waitFor("两条 dispatch", (m) => {
      const ds = (m.entries[MAIN_THREAD_ID] ?? []).filter((e) => e.kind === "dispatch");
      return ds.length >= 2 && ds;
    });
    const dispatchTaskIds = main.map((e) => (e.kind === "dispatch" ? e.taskId : ""));
    expect(dispatchTaskIds).toEqual(expect.arrayContaining([taskMa.id, taskAke.id]));
    expect(dispatchTaskIds.length).toBe(2); // 不应重复（Pip 和编排器都 append dispatch 会变 4 条）
  });

  it("3. 对小码 steer、对阿克 queue（并保证触发审批）", async () => {
    await c.waitFor("小码在跑", (m) => m.tasks[taskMa.id]?.status === "running");
    await c.request("chat.send", { threadId: taskMa.threadId, text: "顺便把错误日志也打出来", mode: "steer" });
    await c.request("chat.send", { threadId: taskAke.threadId, text: "再安装依赖后补充一份接口文档", mode: "queue" });

    const steerEntries = await c.waitFor("steer entry", (m) => {
      const es = (m.entries[taskMa.threadId] ?? []).filter((e) => e.kind === "steer");
      return es.length > 0 && es;
    });
    expect(steerEntries[0]!.kind === "steer" && steerEntries[0]!.mode).toBe("steer");
    const queueEntries = (c.model.entries[taskAke.threadId] ?? []).filter((e) => e.kind === "steer");
    expect(queueEntries.some((e) => e.kind === "steer" && e.mode === "queue")).toBe(true);
  });

  it("4. 审批：queue 的轮次含「安装依赖」-> 出现审批 -> allow -> 任务结束", async () => {
    const ap = await c.waitFor("阿克的审批", (m) =>
      Object.values(m.approvals).find((a) => a.taskId === taskAke.id && a.status === "pending"),
    );
    expect(ap.title).toContain("阿克");
    expect(ap.title).toContain("pnpm install");
    const waiting = c.model.tasks[taskAke.id]!;
    expect(waiting.status).toBe("waiting_approval");
    expect(c.model.bots["bot-ake"]!.status).toBe("waiting_approval");

    allowedIds.add(ap.id);
    const r = await c.request("approval.resolve", { approvalId: ap.id, decision: "allow" });
    expect(r.approval.status).toBe("allowed");

    const doneMa = await untilFinished(taskMa.id);
    const doneAke = await untilFinished(taskAke.id);
    expect(doneMa.status).toBe("done");
    expect(doneAke.status).toBe("done");
    // 主线收到汇报
    const main = c.model.entries[MAIN_THREAD_ID] ?? [];
    await c.waitFor("Pip 汇报", (m) =>
      (m.entries[MAIN_THREAD_ID] ?? []).some((e) => e.kind === "bot" && /完成了/.test(e.text)),
    );
    expect(main.length).toBeGreaterThan(3);
    // 子线程有 steer 被采纳后的条目
    const steer = (c.model.entries[taskMa.threadId] ?? []).find((e) => e.kind === "steer");
    expect(steer && steer.kind === "steer" && steer.applied).toBe("applied");
  });

  it("5. fork 某 entry -> 新任务 + branch", async () => {
    const { entries } = await c.request("thread.get", { threadId: taskMa.threadId });
    const entry = entries.find((e) => e.kind === "bot");
    expect(entry).toBeTruthy();
    const r = await c.request("task.fork", { taskId: taskMa.id, entryId: entry!.id, label: "分支 B：换个思路" });
    expect(r.task.id).not.toBe(taskMa.id);
    expect(r.task.forkedFrom).toEqual({ taskId: taskMa.id, entryId: entry!.id });
    expect(r.branch.taskId).toBe(r.task.id);
    expect(r.branch.forkEntryId).toBe(entry!.id);
    forked = { task: r.task, branchId: r.branch.id };

    const { branches } = await c.request("task.branches", { taskId: taskMa.id });
    expect(branches.some((b) => b.id === forked.branchId)).toBe(true);
    await c.waitFor("branch.updated 推送", (m) => m.branches[forked.branchId]);
  });

  it("6. branch.adopt -> 记录采纳并产生 user 事件", async () => {
    const r = await c.request("branch.adopt", { branchId: forked.branchId });
    expect(r.branch.adopted).toBe(true);
    await c.waitFor("user 事件", (m) => m.events.find((e) => e.source === "user" && /采纳/.test(e.title)));
  });

  it("7. 新建 cron 触发器 + trigger.fire（auto）：起任务，审批被自动拒绝", async () => {
    const r = await c.request("trigger.upsert", {
      trigger: {
        label: "每日 e2e 简报",
        source: "cron",
        params: { expr: "0 0 1 1 *", tz: "Asia/Shanghai", prompt: "整理今日要点，并安装依赖" },
        targetBotId: "bot-xiaotan",
        mode: "auto",
        enabled: true,
        dailyBudget: 5,
        autoDenyApprovalsWhenUnattended: true,
      },
    });
    cronRule = r.trigger;
    expect(cronRule.id).toBeTruthy();
    expect((await c.request("trigger.list", {})).triggers.some((t) => t.id === cronRule.id)).toBe(true);

    const { eventId } = await c.request("trigger.fire", { triggerId: cronRule.id });
    expect(eventId).toBeTruthy();
    const ev = await c.waitFor("cron 事件", (m) => m.events.find((e) => e.id === eventId));
    expect(ev.source).toBe("cron");
    expect(ev.taskId).toBeTruthy();

    const task = await untilFinished(ev.taskId!);
    expect(task.botId).toBe("bot-xiaotan");
    expect(task.status).toBe("done");
    // 该任务的审批必须是无人值守并被自动拒绝，且我们的 allowPending 从未放行它
    const aps = Object.values(c.model.approvals).filter((a) => a.taskId === task.id);
    expect(aps.length).toBeGreaterThan(0);
    for (const a of aps) {
      expect(a.unattended).toBe(true);
      expect(a.status).toBe("denied");
    }
  });

  it("8. event.list 能看到 user / cron / callback 事件", async () => {
    for (const source of ["user", "cron", "callback"] as const) {
      const { events } = await c.request("event.list", { source });
      expect(events.length, `source=${source}`).toBeGreaterThan(0);
      expect(events.every((e) => e.source === source)).toBe(true);
    }
    // 分页：before 之前的事件都更早
    const all = (await c.request("event.list", {})).events;
    const mid = all[Math.floor(all.length / 2)]!;
    const older = (await c.request("event.list", { before: mid.ts })).events;
    expect(older.every((e) => e.ts < mid.ts)).toBe(true);
  });

  it("9. 全程 push 的 seq 连续", () => {
    expect(c.seqGaps).toEqual([]);
  });

  it("10. stop 后同一 dataDir 重启：任务/线程/事件仍在", async () => {
    const before = c.model;
    const taskIds = Object.keys(before.tasks).sort();
    const eventIds = before.events.map((e) => e.id);
    const seqBefore = before.seq;
    c.close();
    await daemon!.stop();
    daemon = undefined;

    daemon = await startDaemon({ dataDir, port: 0, token: TOKEN, fake: true });
    c = await TestClient.connect(daemon.port);
    const snap = await c.request("hub.snapshot", {});

    expect(snap.tasks.map((t) => t.id).sort()).toEqual(taskIds);
    for (const id of eventIds) expect(snap.recentEvents.some((e) => e.id === id)).toBe(true);
    expect(snap.threads.some((t) => t.id === taskMa.threadId)).toBe(true);
    expect(snap.triggers.some((t) => t.id === cronRule.id)).toBe(true);
    expect(snap.seq).toBeGreaterThanOrEqual(seqBefore);
    // 已完成的任务重启后不应被改写
    expect(snap.tasks.find((t) => t.id === taskMa.id)?.status).toBe("done");
    // 线程历史可取
    const { entries } = await c.request("thread.get", { threadId: taskMa.threadId });
    expect(entries.length).toBeGreaterThan(3);
    const main = await c.request("thread.get", { threadId: MAIN_THREAD_ID });
    expect(main.entries.filter((e) => e.kind === "dispatch").length).toBe(2);
    // 重启后仍可继续收到推送（seq 在持久化基础上递增）
    await c.request("trigger.fire", { triggerId: cronRule.id });
    await c.waitFor("重启后新事件", (m) => m.seq > snap.seq);
  }, 30000);
});
