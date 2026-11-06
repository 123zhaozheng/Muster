import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approval, Entry, WirePush } from "@muster/protocol";
import { MAIN_THREAD_ID } from "@muster/protocol";
import { applyPush, modelFromSnapshot } from "@muster/protocol/reducer";
import { createMockClient, type MockClient } from "./mockClient";

let c: MockClient;
const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const entries = (threadId: string): Entry[] => c.getModel().entries[threadId] ?? [];

beforeEach(() => {
  vi.useFakeTimers();
  c = createMockClient({ stepMs: 100, typeMs: 1, scanMs: 0 });
});
afterEach(() => {
  c.close();
  vi.useRealTimers();
});

describe("snapshot / thread.get / pushes", () => {
  it("snapshot 带夹具数据，thread.get 对未知线程报 not_found", async () => {
    const snap = await c.request("hub.snapshot", {});
    expect(snap.bots.map((b) => b.name)).toContain("小码");
    expect(snap.tasks).toHaveLength(3);
    const got = await c.request("thread.get", { threadId: "thread-fix-callback" });
    expect(got.entries.length).toBeGreaterThan(5);
    await expect(c.request("thread.get", { threadId: "nope" })).rejects.toThrow(/not_found/);
  });

  it("push 的 seq 连续递增，且按 snapshot + pushes 重放得到与内部模型一致的状态", async () => {
    const pushes: WirePush[] = [];
    c.onPush((p) => pushes.push(p));
    const snap = await c.request("hub.snapshot", {});
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "交给小码修 a，交给阿克写 b" });
    await run(3000);
    expect(pushes.length).toBeGreaterThan(10);
    pushes.forEach((p, i) => expect(p.seq).toBe(snap.seq + 1 + i));

    let replay = modelFromSnapshot(snap);
    for (const p of pushes) replay = { ...applyPush(replay, p.push), seq: p.seq };
    const live = c.getModel();
    expect(replay.tasks).toEqual(live.tasks);
    expect(replay.bots).toEqual(live.bots);
    expect(replay.threads).toEqual(live.threads);
    expect(replay.approvals).toEqual(live.approvals);
    expect(replay.events).toEqual(live.events);
    expect(replay.seq).toBe(live.seq);
  });
});

describe("主线分发", () => {
  it("识别 Bot 名：流式回复 + 两张派发卡 + 两个新任务", async () => {
    const before = Object.keys(c.getModel().tasks).length;
    const cardsBefore = entries(MAIN_THREAD_ID).filter((e) => e.kind === "dispatch").length;
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "交给小码修支付回调，交给阿克写退款接口" });
    await run(2000);
    const m = c.getModel();
    const cards = entries(MAIN_THREAD_ID).filter((e) => e.kind === "dispatch");
    expect(cards).toHaveLength(cardsBefore + 2);
    expect(cards.slice(-2).map((e) => e.kind === "dispatch" && e.title)).toEqual(["修支付回调", "写退款接口"]);
    expect(Object.keys(m.tasks).length).toBe(before + 2);
    const pipReply = entries(MAIN_THREAD_ID).findLast((e) => e.kind === "bot" && e.text === "好的，我来安排一下：");
    expect(pipReply && pipReply.kind === "bot" && pipReply.streaming).toBe(false);
    const created = Object.values(m.tasks).find((t) => t.title === "修支付回调");
    expect(created?.botId).toBe("bot-xiaoma");
    expect(m.threads[created!.threadId]?.taskId).toBe(created!.id);
    expect(m.bots["bot-pip"]?.status).toBe("idle");
  });

  it("没提到任何 Bot 时给出引导而不是派发", async () => {
    const before = Object.keys(c.getModel().tasks).length;
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "你好" });
    await run(1000);
    expect(Object.keys(c.getModel().tasks).length).toBe(before);
    expect(entries(MAIN_THREAD_ID).some((e) => e.kind === "choices" && e.options.includes("交给小码"))).toBe(true);
  });

  it("派发出的任务会自己推进：工具摘要 -> 审批 -> 批准后 -> diff/测试 -> 完成并回调", async () => {
    await c.request("chat.send", { threadId: MAIN_THREAD_ID, text: "交给小码修支付回调" });
    await run(1000);
    const task = Object.values(c.getModel().tasks).find((t) => t.title === "修支付回调")!;
    await run(1500);
    const waiting = c.getModel().tasks[task.id]!;
    expect(waiting.status).toBe("waiting_approval");
    const ap = Object.values(c.getModel().approvals).find((a) => a.taskId === task.id)!;
    expect(ap.status).toBe("pending");
    expect(c.getModel().bots["bot-xiaoma"]?.status).toBe("waiting_approval");

    await c.request("approval.resolve", { approvalId: ap.id, decision: "allow" });
    await run(3000);
    const done = c.getModel().tasks[task.id]!;
    expect(done.status).toBe("done");
    expect(done.progress).toBe(100);
    const kinds = entries(task.threadId).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["tool_summary", "approval", "diff", "test_result"]));
    expect(c.getModel().events.some((e) => e.source === "callback" && e.taskId === task.id)).toBe(true);
  });
});

describe("子线程 steer / queue / interrupt", () => {
  it("steer 先是 next_step，到下一步边界变 applied", async () => {
    const r = await c.request("chat.send", { threadId: "thread-fix-callback", text: "别动 package.json", mode: "steer" });
    const find = () => entries("thread-fix-callback").find((e) => e.id === r.entryId);
    expect(find()).toMatchObject({ kind: "steer", mode: "steer", applied: "next_step" });
    await run(150);
    expect(find()).toMatchObject({ applied: "applied" });
    expect(entries("thread-fix-callback").some((e) => e.kind === "bot" && e.text.includes("别动 package.json"))).toBe(true);
  });

  it("queue 在当前回合结束后才处理；normal 忙碌时等同 queue", async () => {
    const q = await c.request("chat.send", { threadId: "thread-fix-callback", text: "完事后补一个测试", mode: "queue" });
    const n = await c.request("chat.send", { threadId: "thread-fix-callback", text: "再看下日志" });
    const find = (id: string) => entries("thread-fix-callback").find((e) => e.id === id);
    expect(find(q.entryId)).toMatchObject({ kind: "steer", mode: "queue", applied: "pending" });
    expect(find(n.entryId)).toMatchObject({ kind: "steer", mode: "queue", applied: "pending" });
    await run(250);
    expect(c.getModel().tasks["task-fix-callback"]?.status).toBe("running");
    expect(find(q.entryId)).toMatchObject({ applied: "pending" });
    await run(3000);
    expect(find(q.entryId)).toMatchObject({ applied: "applied" });
    expect(find(n.entryId)).toMatchObject({ applied: "applied" });
    expect(c.getModel().tasks["task-fix-callback"]?.status).toBe("done");
  });

  it("interrupt 立即生效并终止当前脚本", async () => {
    const r = await c.request("chat.send", { threadId: "thread-fix-callback", text: "停，换个思路", mode: "interrupt" });
    expect(entries("thread-fix-callback").find((e) => e.id === r.entryId)).toMatchObject({ kind: "steer", mode: "interrupt", applied: "applied" });
    await run(3000);
    // 被打断后只跑"收到 -> 处理"的小回合，原脚本里的 diff 不会再出现
    expect(entries("thread-fix-callback").filter((e) => e.kind === "diff")).toHaveLength(1);
    expect(c.getModel().tasks["task-fix-callback"]?.status).toBe("done");
  });

  it("task.interrupt 让任务回到待命，随后发消息会重新开始一个回合", async () => {
    await c.request("task.interrupt", { taskId: "task-fix-callback" });
    expect(c.getModel().tasks["task-fix-callback"]?.status).toBe("queued");
    await run(1000);
    expect(c.getModel().tasks["task-fix-callback"]?.status).toBe("queued");
    await c.request("chat.send", { threadId: "thread-fix-callback", text: "继续" });
    expect(c.getModel().tasks["task-fix-callback"]?.status).toBe("running");
    await run(1000);
    expect(c.getModel().tasks["task-fix-callback"]?.status).toBe("done");
  });

  it("task.cancel 结束任务，之后不再推进", async () => {
    await c.request("task.cancel", { taskId: "task-fix-callback-b" });
    const t = c.getModel().tasks["task-fix-callback-b"]!;
    expect(t.status).toBe("cancelled");
    await run(2000);
    expect(c.getModel().tasks["task-fix-callback-b"]?.status).toBe("cancelled");
    await expect(c.request("task.cancel", { taskId: "task-fix-callback-b" })).rejects.toThrow(/conflict/);
  });
});

describe("审批", () => {
  it("夹具里的待审批任务停在原地，允许后继续并完成", async () => {
    await run(2000);
    expect(c.getModel().tasks["task-refund-api"]?.status).toBe("waiting_approval");
    const { approval } = await c.request("approval.resolve", { approvalId: "ap-1", decision: "allow" });
    expect(approval.status).toBe("allowed");
    expect(approval.resolvedAt).toBeTruthy();
    expect(c.getModel().tasks["task-refund-api"]?.status).toBe("running");
    await run(2000);
    expect(c.getModel().tasks["task-refund-api"]?.status).toBe("done");
  });

  it("拒绝同样会让任务继续（换方式），重复处理报 conflict，未知 id 报 not_found", async () => {
    const { approval } = await c.request("approval.resolve", { approvalId: "ap-1", decision: "deny" });
    expect(approval.status).toBe("denied");
    expect(entries("thread-refund-api").some((e) => e.kind === "bot" && e.text.includes("不运行"))).toBe(true);
    await expect(c.request("approval.resolve", { approvalId: "ap-1", decision: "allow" })).rejects.toThrow(/conflict/);
    await expect(c.request("approval.resolve", { approvalId: "zzz", decision: "allow" })).rejects.toThrow(/not_found/);
  });
});

describe("fork / 分支", () => {
  it("fork 生成新任务与 Branch，task.branches 返回整个家族，adopt 互斥", async () => {
    const { task, branch } = await c.request("task.fork", { taskId: "task-fix-callback", entryId: "e-wb-5", label: "重试方案" });
    expect(task.forkedFrom).toEqual({ taskId: "task-fix-callback", entryId: "e-wb-5" });
    expect(task.parentThreadId).toBe("thread-fix-callback");
    expect(branch).toMatchObject({ taskId: task.id, forkEntryId: "e-wb-5", label: "分支 C：重试方案" });
    expect(c.getModel().threads[task.threadId]?.taskId).toBe(task.id);

    const { branches } = await c.request("task.branches", { taskId: "task-fix-callback" });
    expect(branches.map((b) => b.id).sort()).toEqual(["br-a", "br-b", branch.id].sort());

    await c.request("branch.adopt", { branchId: "br-a" });
    const second = await c.request("branch.adopt", { branchId: branch.id });
    expect(second.branch.adopted).toBe(true);
    const after = (await c.request("task.branches", { taskId: task.id })).branches;
    expect(after.filter((b) => b.adopted).map((b) => b.id)).toEqual([branch.id]);

    await run(3000);
    expect(c.getModel().tasks[task.id]?.status).toBe("done");
    expect(c.getModel().branches[branch.id]?.tests).toEqual({ passed: 11, failed: 1 });
  });

  it("首次分支的原任务补出 分支 A，条目不存在时 not_found", async () => {
    const { branch } = await c.request("task.fork", { taskId: "task-refund-api", entryId: (entries("thread-refund-api")[0] as Entry).id });
    expect(branch.label.startsWith("分支 B")).toBe(true);
    const { branches } = await c.request("task.branches", { taskId: "task-refund-api" });
    expect(branches).toHaveLength(2);
    await expect(c.request("task.fork", { taskId: "task-fix-callback", entryId: "nope" })).rejects.toThrow(/not_found/);
  });
});

describe("触发器", () => {
  it("CRUD：新增、修改、删除，并校验目标 Bot", async () => {
    const base = { label: "每周五复盘", source: "cron" as const, params: { expr: "0 18 * * 5" }, targetBotId: "bot-xiaotan", mode: "ask" as const, enabled: true, dailyBudget: 1, autoDenyApprovalsWhenUnattended: true };
    const { trigger } = await c.request("trigger.upsert", { trigger: base });
    expect(trigger.id).toBeTruthy();
    const { trigger: edited } = await c.request("trigger.upsert", { trigger: { ...trigger, mode: "observe" } });
    expect(edited).toMatchObject({ id: trigger.id, mode: "observe", label: "每周五复盘" });
    expect((await c.request("trigger.list", {})).triggers).toHaveLength(4);
    await expect(c.request("trigger.upsert", { trigger: { ...base, targetBotId: "ghost" } })).rejects.toThrow(/bad_request/);
    await c.request("trigger.delete", { triggerId: trigger.id });
    expect((await c.request("trigger.list", {})).triggers).toHaveLength(3);
    await expect(c.request("trigger.delete", { triggerId: trigger.id })).rejects.toThrow(/not_found/);
  });

  it("观察模式：只记录事件，不派发", async () => {
    const tasks = Object.keys(c.getModel().tasks).length;
    const { eventId } = await c.request("trigger.fire", { triggerId: "tr-device" });
    const ev = c.getModel().events.find((e) => e.id === eventId)!;
    expect(ev).toMatchObject({ source: "device", status: "recorded", triggerId: "tr-device" });
    expect(ev.detail).toContain("观察模式");
    expect(Object.keys(c.getModel().tasks).length).toBe(tasks);
    expect(c.getModel().triggers["tr-device"]?.lastFiredAt).toBeTruthy();
  });

  it("询问模式：生成待确认审批，允许后才派发任务", async () => {
    const tasks = Object.keys(c.getModel().tasks).length;
    const { eventId } = await c.request("trigger.fire", { triggerId: "tr-pr" });
    expect(c.getModel().events.find((e) => e.id === eventId)).toMatchObject({ source: "github", status: "recorded" });
    expect(Object.keys(c.getModel().tasks).length).toBe(tasks);
    const ap = Object.values(c.getModel().approvals).find((a: Approval) => a.status === "pending" && !a.taskId)!;
    expect(ap.botId).toBe("bot-ake");
    await c.request("approval.resolve", { approvalId: ap.id, decision: "allow" });
    expect(Object.keys(c.getModel().tasks).length).toBe(tasks + 1);
    expect(c.getModel().events.some((e) => e.triggerId === "tr-pr" && e.status === "dispatched" && e.taskId)).toBe(true);
  });

  it("自动模式：直接派发，受每日预算限制，无人值守的审批自动拒绝", async () => {
    const { eventId } = await c.request("trigger.fire", { triggerId: "tr-brief" });
    const ev = c.getModel().events.find((e) => e.id === eventId)!;
    expect(ev.status).toBe("dispatched");
    const task = c.getModel().tasks[ev.taskId!]!;
    expect(task.botId).toBe("bot-xiaotan");
    expect(entries(MAIN_THREAD_ID).some((e) => e.kind === "dispatch" && e.taskId === task.id)).toBe(true);

    await run(1500); // 走到审批步骤，无人值守 -> 自动拒绝
    const ap = Object.values(c.getModel().approvals).find((a) => a.taskId === task.id)!;
    expect(ap).toMatchObject({ status: "denied", unattended: true });
    await run(2000);
    expect(c.getModel().tasks[task.id]?.status).toBe("done");

    const { eventId: second } = await c.request("trigger.fire", { triggerId: "tr-brief" }); // 预算 1 次/天
    expect(c.getModel().events.find((e) => e.id === second)?.status).toBe("ignored");
  });

  it("event.list 支持 source 过滤、limit 与 before 分页，按时间倒序", async () => {
    const gh = await c.request("event.list", { source: "github" });
    expect(gh.events.every((e) => e.source === "github")).toBe(true);
    const all = (await c.request("event.list", { limit: 3 })).events;
    expect(all).toHaveLength(3);
    expect(all[0]!.ts >= all[1]!.ts).toBe(true);
    const older = (await c.request("event.list", { before: all[2]!.ts })).events;
    expect(older.every((e) => e.ts < all[2]!.ts)).toBe(true);
  });
});

describe("Bot 与设备", () => {
  it("bot.detectAgents 返回检测结果；bot.add 新增并拒绝重名", async () => {
    const { agents } = await c.request("bot.detectAgents", {});
    expect(agents.find((a) => a.engine === "codex")?.found).toBe(true);
    expect(agents.find((a) => a.engine === "opencode")?.found).toBe(false);

    const { bot } = await c.request("bot.add", { name: "小研", kind: "claude" });
    expect(bot).toMatchObject({ name: "小研", engineLabel: "Claude", status: "idle" });
    expect(c.getModel().bots[bot.id]).toEqual(bot);
    await expect(c.request("bot.add", { name: "小研", kind: "codex" })).rejects.toThrow(/conflict/);
    await expect(c.request("bot.add", { name: "  ", kind: "codex" })).rejects.toThrow(/bad_request/);
    // 新 Bot 的线程在第一次 thread.get 时可用
    expect((await c.request("thread.get", { threadId: bot.threadId })).entries).toEqual([]);
  });

  it("device.list / device.pairCode", async () => {
    expect((await c.request("device.list", {})).devices).toHaveLength(3);
    const { code, expiresAt } = await c.request("device.pairCode", {});
    expect(code).toMatch(/^\d{6}$/);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe("close", () => {
  it("关闭后不再推进、请求失败", async () => {
    const pushes: WirePush[] = [];
    c.onPush((p) => pushes.push(p));
    c.close();
    await run(5000);
    expect(pushes).toHaveLength(0);
    await expect(c.request("hub.snapshot", {})).rejects.toThrow();
  });
});
