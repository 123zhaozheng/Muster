// 演示模式（?mock=1）的初始世界：一段自洽的"今天"。
// 主线里 Pip 把"修复支付回调"派给小码（已完成）、把"写退款接口"派给阿克（等你确认 pnpm install），
// 小探（DeepSeek）在后台做招聘调研，小文（Qwen）上周写过周报。成本、状态、时间全部由下面的任务推导。
import type { Approval, Bot, DiffFile, Entry, HubEvent, ModelProviderConfig, ModelRef, ModelSettings, Snapshot, Task, Thread, TriggerRule } from "@muster/protocol";
import { MAIN_BOT_ID, MAIN_THREAD_ID } from "@muster/protocol";

const PAYMENT_PATCH = "@@ -98,7 +98,8 @@\n-  if (signature !== expected) {\n+  if (signature !== expected && !isLegacySignature(req)) {\n     return res.status(401).json({ error: 'Invalid signature' })\n   }\n";

const PAYMENT_DIFF: DiffFile[] = [
  { path: "src/payment/callback.ts", additions: 4, deletions: 1, patch: PAYMENT_PATCH },
  { path: "tests/callback.test.ts", additions: 18, deletions: 0, patch: "@@ -1,3 +1,21 @@\n+import { isLegacySignature } from '../src/payment/signature'\n" },
];

const REFUND_DIFF: DiffFile[] = [
  { path: "src/refund/service.ts", additions: 46, deletions: 0, patch: "@@ -0,0 +1,46 @@\n+export async function refundOrder(orderId: string, amount: number) {\n+  // 校验订单状态与可退金额，再调用支付渠道退款\n+}\n" },
  { path: "src/refund/routes.ts", additions: 21, deletions: 0, patch: "@@ -0,0 +1,21 @@\n+router.post('/orders/:id/refund', refundHandler)\n" },
];

/** 任务完成前展示的改动：退款类任务给退款相关文件，其余给支付回调。 */
export const diffFor = (title: string): DiffFile[] => (/退款/.test(title) ? REFUND_DIFF : PAYMENT_DIFF);

const MOCK_DEFAULT_MODEL: ModelRef = { provider: "deepseek", modelId: "deepseek-flash" };
const QWEN_MODEL: ModelRef = { provider: "qwen-token-plan-cn", modelId: "qwen3-max" };
const DEEPSEEK_PRO: ModelRef = { provider: "deepseek", modelId: "deepseek-v4-pro" };

type EntryBody = Entry extends infer E ? (E extends Entry ? Omit<E, "id" | "threadId" | "ts"> : never) : never;

interface DemoSeed {
  snapshot: Snapshot;
  entries: Record<string, Entry[]>;
  providers: ModelProviderConfig[];
  /** provider id -> 演示用 key（只留在 mock 内部，永远不进 model / push）。 */
  apiKeys: Record<string, string>;
}

const DEMO_CWD = "D:/work/shop-api";

/** 最近一次"每天 09:00（Asia/Shanghai）"的触发时刻。 */
function lastMorningFire(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCHours(1, 0, 0, 0);
  return d.getTime() > nowMs ? d.getTime() - 86_400_000 : d.getTime();
}

export function buildDemoSeed(nowMs: number): DemoSeed {
  const at = (minAgo: number) => new Date(nowMs - minAgo * 60_000).toISOString();

  // ── 任务 ──
  const tasks: Task[] = [
    { id: "task-fix-callback", title: "修复支付回调", botId: "bot-xiaoma", threadId: "thread-fix-callback", parentThreadId: MAIN_THREAD_ID, status: "done", progress: 100, cwd: DEMO_CWD, branch: "muster/fix-callback", startedAt: at(48), finishedAt: at(14), tokens: 84_200, costUsd: 0.41 },
    { id: "task-refund-api", title: "写退款接口", botId: "bot-ake", threadId: "thread-refund-api", parentThreadId: MAIN_THREAD_ID, status: "waiting_approval", cwd: DEMO_CWD, branch: "muster/refund-api", startedAt: at(48), tokens: 61_000, costUsd: 0.56 },
    { id: "task-hiring-research", title: "招聘信息调研", botId: "bot-xiaotan", threadId: "thread-hiring-research", parentThreadId: "thread-bot-xiaotan", status: "running", startedAt: at(24), tokens: 9_800, costUsd: 0.06 },
    { id: "task-weekly-report", title: "撰写项目进展周报", botId: "bot-xiaowen", threadId: "thread-weekly-report", parentThreadId: "thread-bot-xiaowen", status: "done", progress: 100, startedAt: at(1500), finishedAt: at(1485), tokens: 21_400, costUsd: 0.19 },
  ];
  const weekCost = (botId: string) => Math.round(tasks.filter((t) => t.botId === botId).reduce((sum, t) => sum + (t.costUsd ?? 0), 0) * 100) / 100;

  // ── 成员 ──
  const bots: Bot[] = [
    { id: MAIN_BOT_ID, name: "Pip", kind: "main", engineLabel: "主 Bot · 只做分发", tagline: "理解你的想法，安排合适的成员", shape: "round", color: "cream", status: "idle", skills: ["任务分发", "流程编排"], costWeekUsd: weekCost(MAIN_BOT_ID), threadId: MAIN_THREAD_ID, builtin: true },
    { id: "bot-xiaoma", name: "小码", kind: "codex", engineLabel: "Codex", tagline: "代码与调试", shape: "square", color: "mint", status: "idle", skills: ["代码实现", "问题排查", "测试与优化"], costWeekUsd: weekCost("bot-xiaoma"), threadId: "thread-bot-xiaoma" },
    { id: "bot-ake", name: "阿克", kind: "claude", engineLabel: "Claude", tagline: "复杂任务与实现", shape: "blob", color: "peach", status: "waiting_approval", statusDetail: "写退款接口", skills: ["方案设计", "任务拆解", "工程实现"], costWeekUsd: weekCost("bot-ake"), threadId: "thread-bot-ake" },
    {
      id: "bot-xiaotan",
      name: "小探",
      kind: "native",
      engineLabel: "DeepSeek",
      tagline: "搜索与研究",
      shape: "egg",
      color: "sky",
      status: "working",
      statusDetail: "招聘信息调研",
      skills: ["信息检索", "资料分析", "趋势与竞品研究"],
      costWeekUsd: weekCost("bot-xiaotan"),
      threadId: "thread-bot-xiaotan",
      persona: "你是小探，负责信息检索、资料整理与深入调研，为决策提供依据。先把问题拆开，查证后再给结论；每个结论都标明来源，不确定的地方直说不确定。回答用中文，结构清晰。",
      model: DEEPSEEK_PRO,
      tools: ["files", "web"],
      builtin: true,
    },
    {
      id: "bot-xiaowen",
      name: "小文",
      kind: "native",
      engineLabel: "Qwen",
      tagline: "写作与表达",
      shape: "flat",
      color: "lilac",
      status: "sleeping",
      skills: ["文案写作", "内容润色", "结构优化"],
      costWeekUsd: weekCost("bot-xiaowen"),
      threadId: "thread-bot-xiaowen",
      persona: "你是小文，擅长将想法整理为清晰、专业的文字内容，覆盖多种写作场景。先确认读者与目的，再动手；改动已有文件前先说明要改什么。",
      model: QWEN_MODEL,
      tools: ["files", "edit"],
      builtin: true,
    },
  ];

  // ── 审批 ──
  const approvals: Approval[] = [
    { id: "ap-0", botId: "bot-xiaoma", taskId: "task-fix-callback", title: "小码 想运行 pnpm test", detail: "pnpm test --filter payment", risk: "low", status: "allowed", createdAt: at(44), resolvedAt: at(43) },
    { id: "ap-1", botId: "bot-ake", taskId: "task-refund-api", title: "阿克 想运行 pnpm install", detail: "pnpm install --frozen-lockfile", risk: "medium", status: "pending", createdAt: at(16) },
  ];

  // ── 会话 ──
  const threads: Thread[] = [
    { id: MAIN_THREAD_ID, title: "主线", botId: MAIN_BOT_ID, createdAt: at(60 * 24 * 10), updatedAt: at(9.5), lastText: "改了两个文件：src/payment/callback.ts 加了旧签名兼容，tests/callback.test.ts 补了回归测试，12 项测试全部通过。" },
    { id: "thread-fix-callback", title: "修复支付回调", botId: "bot-xiaoma", taskId: "task-fix-callback", createdAt: at(48), updatedAt: at(14), lastText: "12 项测试通过" },
    { id: "thread-refund-api", title: "写退款接口", botId: "bot-ake", taskId: "task-refund-api", createdAt: at(48), updatedAt: at(16), lastText: "需要安装项目依赖" },
    { id: "thread-hiring-research", title: "招聘信息调研", botId: "bot-xiaotan", taskId: "task-hiring-research", createdAt: at(24), updatedAt: at(20), lastText: "已读取 8 个页面，正在整理岗位要求" },
    { id: "thread-weekly-report", title: "撰写项目进展周报", botId: "bot-xiaowen", taskId: "task-weekly-report", createdAt: at(1500), updatedAt: at(1485), lastText: "周报已整理完成" },
  ];

  // ── 触发器 ──
  const morning = new Date(lastMorningFire(nowMs)).toISOString();
  const triggers: TriggerRule[] = [
    { id: "tr-brief", label: "晨间简报：项目进展与今日安排", source: "cron", params: { expr: "0 9 * * *", tz: "Asia/Shanghai" }, targetBotId: "bot-xiaotan", mode: "auto", enabled: true, dailyBudget: 1, autoDenyApprovalsWhenUnattended: true, lastFiredAt: morning },
    { id: "tr-pr", label: "当 PR 打开时", source: "github", params: { repo: "shop-api", event: "pull_request.opened" }, targetBotId: "bot-ake", mode: "observe", enabled: true, dailyBudget: 10, autoDenyApprovalsWhenUnattended: true, lastFiredAt: at(120) },
    { id: "tr-device", label: "当设备上线时", source: "device", params: { deviceId: "dev-desktop" }, targetBotId: "bot-xiaoma", mode: "observe", enabled: true, dailyBudget: 5, autoDenyApprovalsWhenUnattended: true },
  ];

  const recentEvents: HubEvent[] = [
    { id: "ev-callback-fix", ts: at(14), source: "callback", title: "回调 · 小码 完成了 修复支付回调", detail: "处理完成，状态已更新", botId: "bot-xiaoma", taskId: "task-fix-callback", status: "delivered" },
    { id: "ev-approval-ake", ts: at(16), source: "system", title: "系统 · 阿克 请求运行 pnpm install，等你确认", botId: "bot-ake", taskId: "task-refund-api", status: "recorded" },
    { id: "ev-research", ts: at(20), source: "callback", title: "回调 · 小探 更新了 招聘信息调研", detail: "已读取 8 个页面，正在整理岗位要求", botId: "bot-xiaotan", taskId: "task-hiring-research", status: "delivered" },
    { id: "ev-allow-test", ts: at(43), source: "user", title: "你 · 允许了：小码 想运行 pnpm test", botId: "bot-xiaoma", taskId: "task-fix-callback", status: "delivered" },
    { id: "ev-dispatch-ake", ts: at(46.9), source: "user", title: "你 · 派发 给 阿克", detail: "写退款接口", botId: "bot-ake", taskId: "task-refund-api", status: "dispatched" },
    { id: "ev-dispatch-ma", ts: at(47), source: "user", title: "你 · 派发 给 小码", detail: "修复支付回调", botId: "bot-xiaoma", taskId: "task-fix-callback", status: "dispatched" },
    { id: "ev-user-main", ts: at(48), source: "user", title: "你 · 帮我修复支付回调，再补一个退款接口。", botId: MAIN_BOT_ID, status: "delivered" },
    { id: "ev-pr", ts: at(120), source: "github", title: "GitHub · PR #128 已打开 · shop-api", detail: "观察模式：已记录将会做什么", botId: "bot-ake", triggerId: "tr-pr", status: "recorded" },
    { id: "ev-morning", ts: morning, source: "cron", title: "定时 · 晨间简报 · 已送达", detail: "已为你生成今日简报", botId: "bot-xiaotan", triggerId: "tr-brief", status: "delivered" },
    { id: "ev-device", ts: at(180), source: "device", title: "设备 · 书房台式机 上线", status: "recorded" },
  ];

  const settings: ModelSettings = { router: MOCK_DEFAULT_MODEL, native: MOCK_DEFAULT_MODEL };

  const snapshot: Snapshot = {
    serverTime: new Date(nowMs).toISOString(),
    seq: 0,
    bots,
    threads,
    tasks,
    approvals,
    triggers,
    devices: [
      { id: "dev-local", name: "MacBook Pro · 本机", os: "macos", isLocal: true, online: true },
      { id: "dev-desktop", name: "书房台式机", os: "linux", isLocal: false, online: true, lastSeenAt: at(1) },
      { id: "dev-cloud", name: "云服务器", os: "linux", isLocal: false, online: false, lastSeenAt: at(2880) },
    ],
    recentEvents,
    modelSettings: settings,
  };

  // ── 会话记录 ──
  const e = (threadId: string, id: string, minAgo: number, body: EntryBody): Entry => ({ ...body, id, threadId, ts: at(minAgo) }) as Entry;
  const M = MAIN_THREAD_ID;
  const entries: Record<string, Entry[]> = {
    [M]: [
      e(M, "e-m-1", 48, { kind: "user", text: "帮我修复支付回调，再补一个退款接口。" }),
      e(M, "e-m-th-1", 48, { kind: "thinking", botId: MAIN_BOT_ID, durationMs: 3_400, text: "用户提了两件事：修支付回调、补退款接口。\n回调是排查和修 bug，适合擅长代码调试的小码；退款接口要先设计再实现，交给做复杂任务的阿克。\n两件事互不依赖，可以并行派发。" }),
      e(M, "e-m-tl-1", 48, {
        kind: "tool_summary",
        botId: MAIN_BOT_ID,
        reads: 2,
        commands: 0,
        edits: 0,
        items: [
          { tool: "read", label: "成员清单", ok: true, output: "小码 · Codex · 空闲\n阿克 · Claude · 空闲\n小探 · DeepSeek · 工作中\n小文 · Qwen · 休息中" },
          { tool: "read", label: "设备 MacBook Pro · 本机", ok: true },
          { tool: "route", label: "新建 2 张工单：修复支付回调 → 小码，写退款接口 → 阿克", ok: true },
        ],
      }),
      e(M, "e-m-2", 47.5, { kind: "bot", botId: MAIN_BOT_ID, text: "我来安排。小码负责回调，阿克处理退款接口。" }),
      e(M, "e-m-3", 47, { kind: "dispatch", botId: "bot-xiaoma", taskId: "task-fix-callback", title: "修复支付回调" }),
      e(M, "e-m-4", 47, { kind: "dispatch", botId: "bot-ake", taskId: "task-refund-api", title: "写退款接口" }),
      e(M, "e-m-5", 16, { kind: "approval", approvalId: "ap-1" }),
      e(M, "e-m-6", 13, { kind: "bot", botId: MAIN_BOT_ID, text: "我已经把任务分配好：小码的回调已完成并通过测试；阿克的退款接口正在推进，但需要先运行 pnpm install 安装依赖。你可以查看并确认，我会继续跟进。" }),
      e(M, "e-m-7", 10, { kind: "user", text: "回调改了哪些文件？" }),
      e(M, "e-m-th-2", 10, { kind: "thinking", botId: MAIN_BOT_ID, durationMs: 2_100, text: "要回答改动范围，读一下小码那张工单的汇报就够了，不用再派人。" }),
      e(M, "e-m-tl-2", 10, { kind: "tool_summary", botId: MAIN_BOT_ID, reads: 1, commands: 0, edits: 0, items: [{ tool: "read", label: "工单 修复支付回调 · 汇报", ok: true }] }),
      e(M, "e-m-8", 9.5, { kind: "bot", botId: MAIN_BOT_ID, text: "改了两个文件：`src/payment/callback.ts` 加了旧签名兼容，`tests/callback.test.ts` 补了回归测试，12 项测试全部通过。" }),
    ],
    "thread-fix-callback": [
      e("thread-fix-callback", "e-wb-1", 48, { kind: "system", text: "Pip 派发了任务：修复支付回调" }),
      e("thread-fix-callback", "e-wb-th-1", 47, { kind: "thinking", botId: "bot-xiaoma", durationMs: 8_200, text: "回调失败多半出在验签：新版支付渠道换了签名算法，旧订单还在用旧签名。\n先看 src/payment/callback.ts 的验签分支和对应测试，确认失败用例再动手。" }),
      e("thread-fix-callback", "e-wb-2", 47, { kind: "bot", botId: "bot-xiaoma", text: "我来修复支付回调的兼容性问题，先分析一下代码结构…" }),
      e("thread-fix-callback", "e-wb-3", 44, { kind: "approval", approvalId: "ap-0" }),
      e("thread-fix-callback", "e-wb-4", 42, {
        kind: "tool_summary",
        botId: "bot-xiaoma",
        reads: 6,
        commands: 2,
        edits: 0,
        items: [
          { tool: "read", label: "src/payment/callback.ts", ok: true },
          { tool: "read", label: "src/payment/signature.ts", ok: true },
          { tool: "bash", label: "pnpm test --filter payment", ok: true },
        ],
      }),
      e("thread-fix-callback", "e-wb-5", 32, { kind: "steer", text: "回调要兼容旧签名", mode: "steer", applied: "applied" }),
      e("thread-fix-callback", "e-wb-6", 31, { kind: "bot", botId: "bot-xiaoma", text: "收到，我会检查旧签名的验证逻辑，并添加兼容处理。先看一下相关的测试用例…" }),
      e("thread-fix-callback", "e-wb-7", 28, { kind: "tool_summary", botId: "bot-xiaoma", reads: 4, commands: 1, edits: 1, items: [{ tool: "read", label: "tests/callback.test.ts", ok: true }, { tool: "edit", label: "src/payment/callback.ts", ok: true }] }),
      e("thread-fix-callback", "e-wb-8", 20, { kind: "diff", botId: "bot-xiaoma", files: PAYMENT_DIFF }),
      e("thread-fix-callback", "e-wb-9", 15, { kind: "test_result", botId: "bot-xiaoma", passed: 12, failed: 0 }),
      e("thread-fix-callback", "e-wb-10", 14, { kind: "bot", botId: "bot-xiaoma", text: "「修复支付回调」已完成，改动已写入工作区（12 通过 · 0 失败）。" }),
    ],
    "thread-refund-api": [
      e("thread-refund-api", "e-rf-1", 48, { kind: "system", text: "Pip 派发了任务：写退款接口" }),
      e("thread-refund-api", "e-rf-th-1", 46, { kind: "thinking", botId: "bot-ake", durationMs: 12_600, text: "退款接口需要：校验订单状态、计算可退金额、调用支付渠道退款、记录流水。\n先摸清订单与支付模块的现有接口，避免重复造轮子；部分退款要防止超额。" }),
      e("thread-refund-api", "e-rf-2", 46, { kind: "bot", botId: "bot-ake", text: "我来实现退款接口：先梳理现有的订单与支付模块，再补上路由与校验。" }),
      e("thread-refund-api", "e-rf-3", 30, { kind: "tool_summary", botId: "bot-ake", reads: 5, commands: 1, edits: 0, items: [{ tool: "read", label: "src/order/service.ts", ok: true }, { tool: "read", label: "src/payment/callback.ts", ok: true }, { tool: "bash", label: "ls node_modules", ok: false }] }),
      e("thread-refund-api", "e-rf-4", 17, { kind: "bot", botId: "bot-ake", text: "项目依赖还没有安装，需要先运行 pnpm install，等你确认后我再继续。" }),
      e("thread-refund-api", "e-rf-5", 16, { kind: "approval", approvalId: "ap-1" }),
    ],
    "thread-hiring-research": [
      e("thread-hiring-research", "e-hr-1", 24, { kind: "system", text: "任务已创建：招聘信息调研" }),
      e("thread-hiring-research", "e-hr-2", 23, { kind: "bot", botId: "bot-xiaotan", text: "我来调研招聘信息与岗位要求，先看看主流招聘站点的公开岗位。" }),
      e("thread-hiring-research", "e-hr-3", 20, { kind: "tool_summary", botId: "bot-xiaotan", reads: 8, commands: 0, edits: 0, items: [{ tool: "web", label: "招聘站点公开岗位列表", ok: true }] }),
      e("thread-hiring-research", "e-hr-4", 19, {
        kind: "tool_summary",
        botId: "bot-xiaotan",
        reads: 1,
        commands: 0,
        edits: 0,
        items: [
          { tool: "web_search", label: "前端工程师 岗位要求 2026", ok: true },
          { tool: "fetch", label: "jobs.example.com/frontend-senior", ok: false, output: "403 Forbidden：站点拒绝抓取" },
          { tool: "read", label: "notes/岗位要求草稿.md" },
        ],
      }),
    ],
    "thread-weekly-report": [
      e("thread-weekly-report", "e-wk-1", 1500, { kind: "system", text: "任务已创建：撰写项目进展周报" }),
      e("thread-weekly-report", "e-wk-2", 1498, { kind: "bot", botId: "bot-xiaowen", text: "我来整理本周的任务记录，起草项目进展周报。" }),
      e("thread-weekly-report", "e-wk-3", 1492, { kind: "tool_summary", botId: "bot-xiaowen", reads: 6, commands: 0, edits: 0, items: [{ tool: "read", label: "notes/本周进展.md", ok: true }] }),
      e("thread-weekly-report", "e-wk-4", 1485, { kind: "bot", botId: "bot-xiaowen", text: "周报已整理完成，包含本周完成的事项与下周计划。" }),
    ],
  };

  const providers: ModelProviderConfig[] = [
    { id: "deepseek", kind: "builtin", builtinId: "deepseek", name: "DeepSeek", hasApiKey: true, enabled: true, createdAt: at(60 * 24 * 3) },
    { id: "qwen-token-plan-cn", kind: "builtin", builtinId: "qwen-token-plan-cn", name: "Qwen Token Plan (China)", hasApiKey: true, enabled: true, createdAt: at(60 * 24 * 2) },
  ];

  return { snapshot, entries, providers, apiKeys: { deepseek: "sk-demo-deepseek", "qwen-token-plan-cn": "sk-demo-qwen" } };
}
