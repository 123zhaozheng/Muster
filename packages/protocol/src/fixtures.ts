/**
 * Sample data mirroring design/mockups/*.png. Used by the web app's mock transport and by tests.
 * Keep ids stable — UI agents hard-code them in stories/tests.
 */
import type { Approval, Bot, Branch, Device, Entry, HubEvent, Snapshot, Task, Thread, TriggerRule } from "./index";
import { MAIN_BOT_ID, MAIN_THREAD_ID } from "./index";

const t = (minAgo: number) => new Date(Date.UTC(2026, 10, 6, 10, 0, 0) - minAgo * 60_000).toISOString();

export const bots: Bot[] = [
  { id: MAIN_BOT_ID, name: "Pip", kind: "main", engineLabel: "主 Bot · 只做分发", shape: "round", color: "cream", status: "idle", skills: ["任务分发", "流程编排"], costWeekUsd: 2.18, threadId: MAIN_THREAD_ID },
  { id: "bot-xiaoma", name: "小码", kind: "codex", engineLabel: "Codex", shape: "square", color: "mint", status: "working", statusDetail: "修支付回调 bug", skills: ["代码生成", "调试优化"], costWeekUsd: 1.24, threadId: "thread-fix-callback" },
  { id: "bot-ake", name: "阿克", kind: "claude", engineLabel: "Claude", shape: "blob", color: "peach", status: "waiting_approval", statusDetail: "写退款接口", skills: ["深度分析", "写作总结"], costWeekUsd: 1.87, threadId: "thread-refund-api" },
  { id: "bot-xiaotan", name: "小探", kind: "native", engineLabel: "内置研究员", shape: "egg", color: "sky", status: "sleeping", skills: ["研究调研", "信息检索"], costWeekUsd: 0.72, threadId: "thread-research" },
  { id: "bot-xiaowen", name: "小文", kind: "native", engineLabel: "内置办公助手", shape: "flat", color: "lilac", status: "done", skills: ["文档处理", "日程管理"], costWeekUsd: 0.96, threadId: "thread-office" },
];

export const tasks: Task[] = [
  { id: "task-fix-callback", title: "修支付回调 bug", botId: "bot-xiaoma", threadId: "thread-fix-callback", parentThreadId: MAIN_THREAD_ID, status: "running", progress: 70, cwd: "D:/work/shop-api", branch: "muster/fix-callback", startedAt: t(32), tokens: 84_200, costUsd: 0.41 },
  { id: "task-refund-api", title: "写退款接口", botId: "bot-ake", threadId: "thread-refund-api", parentThreadId: MAIN_THREAD_ID, status: "waiting_approval", progress: 60, cwd: "D:/work/shop-api", branch: "muster/refund-api", startedAt: t(41), tokens: 61_000, costUsd: 0.56 },
  { id: "task-fix-callback-b", title: "修支付回调 bug（幂等键方案）", botId: "bot-xiaoma", threadId: "thread-fix-callback-b", parentThreadId: "thread-fix-callback", status: "running", progress: 35, cwd: "D:/work/shop-api", branch: "muster/fix-callback-b", forkedFrom: { taskId: "task-fix-callback", entryId: "e-wb-5" }, startedAt: t(8) },
];

export const threads: Thread[] = [
  { id: MAIN_THREAD_ID, title: "主线", botId: MAIN_BOT_ID, createdAt: t(600), updatedAt: t(30), lastText: "好的，我来安排一下：" },
  { id: "thread-fix-callback", title: "修支付回调 bug", botId: "bot-xiaoma", taskId: "task-fix-callback", createdAt: t(32), updatedAt: t(1), lastText: "12 通过 · 0 失败" },
  { id: "thread-refund-api", title: "写退款接口", botId: "bot-ake", taskId: "task-refund-api", createdAt: t(41), updatedAt: t(3), lastText: "想运行 pnpm install" },
  { id: "thread-fix-callback-b", title: "修支付回调 bug（幂等键方案）", botId: "bot-xiaoma", taskId: "task-fix-callback-b", createdAt: t(8), updatedAt: t(2) },
];

export const approvals: Approval[] = [
  { id: "ap-1", botId: "bot-ake", taskId: "task-refund-api", title: "阿克 想运行 pnpm install", detail: "pnpm install --frozen-lockfile", risk: "medium", status: "pending", createdAt: t(3) },
];

export const triggers: TriggerRule[] = [
  { id: "tr-pr", label: "当 PR 打开时", source: "github", params: { repo: "shop-api", event: "pull_request.opened" }, targetBotId: "bot-ake", mode: "ask", enabled: true, dailyBudget: 10, autoDenyApprovalsWhenUnattended: true, lastFiredAt: t(2) },
  { id: "tr-brief", label: "每日 09:00 晨间简报", source: "cron", params: { expr: "0 9 * * *", tz: "Asia/Shanghai" }, targetBotId: "bot-xiaotan", mode: "auto", enabled: true, dailyBudget: 1, autoDenyApprovalsWhenUnattended: true, lastFiredAt: t(60) },
  { id: "tr-device", label: "当设备上线时", source: "device", params: { deviceId: "dev-desktop" }, targetBotId: "bot-xiaoma", mode: "observe", enabled: true, dailyBudget: 5, autoDenyApprovalsWhenUnattended: true },
];

export const devices: Device[] = [
  { id: "dev-local", name: "MacBook Pro · 本机", os: "macos", isLocal: true, online: true },
  { id: "dev-desktop", name: "书房台式机", os: "linux", isLocal: false, online: true, lastSeenAt: t(1) },
  { id: "dev-cloud", name: "云服务器", os: "linux", isLocal: false, online: false, lastSeenAt: t(2880) },
];

export const events: HubEvent[] = [
  { id: "ev-1", ts: t(2), source: "github", title: "GitHub · PR #128 已打开 · shop-api", detail: "观察模式：已记录将会做什么", botId: "bot-ake", triggerId: "tr-pr", status: "recorded" },
  { id: "ev-2", ts: t(60), source: "cron", title: "定时 · 每日 09:00 晨间简报 · 已送达", detail: "已为你生成今日简报", botId: "bot-xiaotan", triggerId: "tr-brief", status: "delivered" },
  { id: "ev-3", ts: t(120), source: "callback", title: "回调 · 小码 完成了 修支付回调", detail: "处理完成，状态已更新", botId: "bot-xiaoma", taskId: "task-fix-callback", status: "delivered" },
  { id: "ev-4", ts: t(180), source: "device", title: "设备 · 书房台式机 上线", status: "recorded" },
  { id: "ev-5", ts: t(240), source: "user", title: "你 · 插话 给 阿克", detail: "先别动数据库迁移", botId: "bot-ake", status: "dispatched" },
];

export const snapshot: Snapshot = {
  serverTime: t(0),
  seq: 0,
  bots,
  threads,
  tasks,
  approvals,
  triggers,
  devices,
  recentEvents: events,
};

/** Entries per thread (main + the workbench thread). */
export const entriesByThread: Record<string, Entry[]> = {
  [MAIN_THREAD_ID]: [
    { id: "e-m-1", threadId: MAIN_THREAD_ID, ts: t(34), kind: "user", text: "shop-api 里两件事：修支付回调 bug 交给小码，写退款接口交给阿克" },
    { id: "e-m-2", threadId: MAIN_THREAD_ID, ts: t(33), kind: "bot", botId: MAIN_BOT_ID, text: "好的，我来安排一下：" },
    { id: "e-m-3", threadId: MAIN_THREAD_ID, ts: t(33), kind: "dispatch", botId: "bot-xiaoma", taskId: "task-fix-callback", title: "修支付回调 bug" },
    { id: "e-m-4", threadId: MAIN_THREAD_ID, ts: t(33), kind: "dispatch", botId: "bot-ake", taskId: "task-refund-api", title: "写退款接口" },
    { id: "e-m-5", threadId: MAIN_THREAD_ID, ts: t(32), kind: "choices", options: ["顺便跑测试", "完成后通知我"], multi: true },
  ],
  "thread-fix-callback": [
    { id: "e-wb-1", threadId: "thread-fix-callback", ts: t(30), kind: "bot", botId: "bot-xiaoma", text: "我来修复支付回调的兼容性问题，先分析一下代码结构…" },
    { id: "e-wb-2", threadId: "thread-fix-callback", ts: t(29), kind: "tool_summary", botId: "bot-xiaoma", reads: 6, commands: 2, edits: 0, items: [{ tool: "read", label: "payment/callback.ts", ok: true }, { tool: "bash", label: "pnpm test", ok: true }] },
    { id: "e-wb-3", threadId: "thread-fix-callback", ts: t(20), kind: "steer", text: "回调要兼容旧签名", mode: "steer", applied: "applied" },
    { id: "e-wb-4", threadId: "thread-fix-callback", ts: t(19), kind: "bot", botId: "bot-xiaoma", text: "收到，我会检查旧签名的验证逻辑，并添加兼容处理。先看一下相关的测试用例…" },
    { id: "e-wb-5", threadId: "thread-fix-callback", ts: t(18), kind: "tool_summary", botId: "bot-xiaoma", reads: 4, commands: 1, edits: 1, items: [] },
    { id: "e-wb-6", threadId: "thread-fix-callback", ts: t(10), kind: "diff", botId: "bot-xiaoma", files: [{ path: "payment/callback.ts", additions: 4, deletions: 4, patch: "@@ -98,7 +98,8 @@\n-  if (signature !== oldSig) {\n-    return res.status(401).json({ error: 'Invalid signature' })\n-  }\n+  if (signature !== oldSig && !isLegacySignature(req)) {\n+    return res.status(401).json({ error: 'Invalid signature' })\n+  }\n" }] },
    { id: "e-wb-7", threadId: "thread-fix-callback", ts: t(2), kind: "test_result", botId: "bot-xiaoma", passed: 12, failed: 0 },
  ],
};

export const branches: Branch[] = [
  { id: "br-a", taskId: "task-fix-callback", forkEntryId: "e-wb-5", label: "分支 A：队列重试", botId: "bot-xiaoma", summary: "在队列失败时进行指数退避重试，提升稳定性。", filesChanged: 3, tests: { passed: 12, failed: 0 }, tokens: 12_400 },
  { id: "br-b", taskId: "task-fix-callback-b", forkEntryId: "e-wb-5", label: "分支 B：幂等键方案", botId: "bot-xiaoma", summary: "引入幂等键，避免重复提交的问题。", filesChanged: 2, tests: { passed: 10, failed: 2 }, tokens: 11_800 },
];
