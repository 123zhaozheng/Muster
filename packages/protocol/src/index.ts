/**
 * Muster wire protocol — THE contract between UI (web / desktop / mobile) and the daemon (musterd).
 *
 * FROZEN for the first build session. If a change is unavoidable, add a field as OPTIONAL and
 * append a line to packages/protocol/CHANGES.md; never rename or remove.
 *
 * Transport: WebSocket `ws://127.0.0.1:<port>/ws?token=<token>`, one JSON object per text frame.
 *   client -> server : WireRequest
 *   server -> client : WireResponse (answers one request) | WirePush (unsolicited)
 * A client always starts with `hub.snapshot`, then applies WirePush items in `seq` order.
 */

// ───────────────────────── ids & small enums ─────────────────────────

export type BotId = string;
export type ThreadId = string;
export type TaskId = string;
export type EntryId = string;
export type ApprovalId = string;
export type TriggerId = string;
export type DeviceId = string;
export type BranchId = string;
export type HubEventId = string;
/** ISO-8601 UTC timestamp. */
export type Iso = string;

/** Avatar / roster state. Drives the mascot expression (see design/mockups/08-mascots.png). */
export type BotStatus =
  | "idle" // 空闲
  | "thinking" // 思考
  | "working" // 工作中
  | "waiting_approval" // 等你审批
  | "done" // 已完成
  | "error" // 出错
  | "sleeping"; // 睡眠

/** Which engine backs a bot. `main` is the thin router (Pip) — it only dispatches. */
export type BotKind = "main" | "codex" | "claude" | "acp" | "native";

export type PebbleShape = "round" | "square" | "blob" | "egg" | "flat";
export type BotColor = "cream" | "mint" | "peach" | "sky" | "lilac" | "rose" | "butter";

export type Risk = "low" | "medium" | "high";
export type TriggerMode = "observe" | "ask" | "auto";
export type EventSource = "user" | "cron" | "github" | "callback" | "device" | "system";

// ───────────────────────── domain objects ─────────────────────────

export interface Bot {
  id: BotId;
  name: string; // 小码
  kind: BotKind;
  /** Small grey label shown under the name: "Codex" | "Claude" | "内置研究员" … */
  engineLabel: string;
  tagline?: string;
  shape: PebbleShape;
  color: BotColor;
  status: BotStatus;
  /** Free text under the status pill, e.g. the current task title. */
  statusDetail?: string;
  skills: string[];
  costWeekUsd: number;
  /** Thread this bot talks in (main bot: the permanent main thread). */
  threadId: ThreadId;
  // ── phase 2 (optional) ──
  /** Native bots: system prompt / role description. */
  persona?: string;
  /** Model this bot uses (native bots; Pip = router model). Unset = the default from model settings. */
  model?: ModelRef;
  /** Native bots: enabled tool groups. */
  tools?: NativeToolGroup[];
  /** Built-in seed bots cannot be removed (they can still be edited). */
  builtin?: boolean;
}

// ───────────────────────── models (phase 2) ─────────────────────────

/** A model inside a configured provider. `provider` is the provider config id. */
export interface ModelRef {
  provider: string;
  modelId: string;
}

/** Tool groups a native bot may use. Writes / commands always go through approvals. */
export type NativeToolGroup =
  | "files" // read / list / grep
  | "edit" // write / edit files (approval)
  | "shell" // run commands (approval)
  | "web"; // fetch web pages

/** One entry of the pi-ai built-in provider catalog. */
export interface ProviderCatalogEntry {
  /** pi-ai provider id, e.g. "deepseek", "anthropic", "moonshot-cn", "openrouter". */
  id: string;
  name: string;
  /** Env var pi-ai reads for the key (shown as a hint). */
  envVar?: string;
  /** Default endpoint (informational). */
  baseUrl?: string;
  modelCount: number;
  /** True when a key is found in the environment even though nothing is stored. */
  envConfigured: boolean;
  /** Region / group label for the picker: "国内" | "国际" | "聚合" | "本地". */
  group?: string;
}

export interface ModelInfo {
  provider: string; // provider config id
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  /** USD per 1M tokens. */
  costInput?: number;
  costOutput?: number;
}

export type ProviderKind = "builtin" | "openai-compatible" | "anthropic-compatible";

/** A provider the user configured. Secrets are NEVER sent to clients (`hasApiKey` only). */
export interface ModelProviderConfig {
  id: string; // builtin: same as builtinId; custom: "custom-xxxx"
  kind: ProviderKind;
  builtinId?: string;
  name: string;
  baseUrl?: string;
  hasApiKey: boolean;
  enabled: boolean;
  /** Compatible providers: models declared by the user (ids). Builtin: optional allow-list (empty = all). */
  modelIds?: string[];
  createdAt: Iso;
}

export interface ModelSettings {
  /** Model Pip (router) uses for understanding & dispatch. Unset = rule-based routing only. */
  router?: ModelRef;
  /** Default model for native bots without their own `model`. */
  native?: ModelRef;
}

export type TaskStatus = "queued" | "running" | "waiting_approval" | "done" | "failed" | "cancelled";

/** One unit of delegated work, executed by exactly one sub-bot session in its own worktree. */
export interface Task {
  id: TaskId;
  title: string;
  botId: BotId;
  threadId: ThreadId; // the sub-bot's thread (workbench conversation)
  parentThreadId: ThreadId; // the thread where it was dispatched (usually main)
  status: TaskStatus;
  /** 0..100 when known. */
  progress?: number;
  cwd?: string;
  branch?: string; // git branch of the worktree, e.g. muster/fix-callback
  /** Set when this task was created by forking another one. */
  forkedFrom?: { taskId: TaskId; entryId: EntryId };
  startedAt: Iso;
  finishedAt?: Iso;
  costUsd?: number;
  tokens?: number;
}

// ── timeline entries (everything shown in a conversation) ──

export interface EntryBase {
  id: EntryId;
  threadId: ThreadId;
  ts: Iso;
}

export type Entry =
  | (EntryBase & { kind: "user"; text: string })
  /** A user message injected while the bot was busy. */
  | (EntryBase & { kind: "steer"; text: string; mode: "steer" | "queue" | "interrupt"; applied: "pending" | "next_step" | "applied" })
  | (EntryBase & { kind: "bot"; botId: BotId; text: string; streaming?: boolean })
  /**
   * The model's reasoning before / between answers ("思考"). Grows via `entry.delta` while `streaming`;
   * `durationMs` is set when it finishes. Text may be an engine summary. Clients that do not know it may skip it.
   */
  | (EntryBase & { kind: "thinking"; botId: BotId; text: string; streaming?: boolean; durationMs?: number })
  /** Folded tool activity: "读取了 6 个文件 · 运行了 2 条命令". */
  | (EntryBase & { kind: "tool_summary"; botId: BotId; reads: number; commands: number; edits: number; items: ToolItem[] })
  /** The main bot dispatching work to a sub-bot (renders as a dispatch card). */
  | (EntryBase & { kind: "dispatch"; botId: BotId; taskId: TaskId; title: string })
  | (EntryBase & { kind: "approval"; approvalId: ApprovalId })
  | (EntryBase & { kind: "test_result"; botId: BotId; passed: number; failed: number })
  | (EntryBase & { kind: "diff"; botId: BotId; files: DiffFile[] })
  | (EntryBase & { kind: "choices"; prompt?: string; options: string[]; multi?: boolean })
  | (EntryBase & { kind: "system"; text: string });

export interface ToolItem {
  tool: string; // "read" | "bash" | "edit" | "grep" | …
  label: string; // "payment/callback.ts" | "pnpm test"
  output?: string; // truncated
  ok?: boolean;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  /** Unified diff text (may be truncated). */
  patch: string;
}

export interface Thread {
  id: ThreadId;
  title: string;
  /** Bot that owns/answers in this thread. */
  botId: BotId;
  taskId?: TaskId;
  createdAt: Iso;
  updatedAt: Iso;
  /** Last line for sidebar previews. */
  lastText?: string;
}

export interface Approval {
  id: ApprovalId;
  botId: BotId;
  taskId?: TaskId;
  /** "小码 想运行 pnpm install" — built by the daemon from structured data, never from model text. */
  title: string;
  detail?: string; // command / preview, shown monospace
  risk: Risk;
  status: "pending" | "allowed" | "denied" | "expired";
  createdAt: Iso;
  resolvedAt?: Iso;
  /** True when the request came from an unattended trigger (auto-deny applies). */
  unattended?: boolean;
}

export interface TriggerRule {
  id: TriggerId;
  label: string; // "当 PR 打开时"
  source: "github" | "cron" | "device" | "callback";
  /** Source parameters: github {repo,event}, cron {expr,tz}, device {deviceId}. */
  params: Record<string, string>;
  targetBotId: BotId;
  mode: TriggerMode;
  enabled: boolean;
  /** Max runs per day (budget). */
  dailyBudget: number;
  autoDenyApprovalsWhenUnattended: boolean;
  lastFiredAt?: Iso;
}

/** One row of the event center. Everything — user input, cron, PR, callbacks — is an event. */
export interface HubEvent {
  id: HubEventId;
  ts: Iso;
  source: EventSource;
  title: string; // "GitHub · PR #128 已打开 · shop-api"
  detail?: string; // "观察模式：已记录将会做什么"
  botId?: BotId;
  triggerId?: TriggerId;
  taskId?: TaskId;
  status?: "recorded" | "delivered" | "dispatched" | "ignored" | "failed";
}

export interface Branch {
  id: BranchId;
  taskId: TaskId; // task that runs on this branch
  /** The entry in the ORIGINAL thread the branch was forked from. */
  forkEntryId: EntryId;
  label: string; // "分支 A：队列重试"
  botId: BotId;
  summary: string;
  filesChanged: number;
  tests?: { passed: number; failed: number };
  tokens?: number;
  adopted?: boolean;
}

export interface Device {
  id: DeviceId;
  name: string;
  os: "windows" | "macos" | "linux";
  isLocal: boolean;
  online: boolean;
  lastSeenAt?: Iso;
}

export interface DetectedAgent {
  engine: "codex" | "claude" | "opencode" | "other";
  command: string;
  version?: string;
  found: boolean;
}

export interface Snapshot {
  serverTime: Iso;
  /** Highest `seq` already reflected in this snapshot. */
  seq: number;
  bots: Bot[];
  threads: Thread[];
  tasks: Task[];
  approvals: Approval[];
  triggers: TriggerRule[];
  devices: Device[];
  recentEvents: HubEvent[];
  /** phase 2: current model settings (router / native defaults). */
  modelSettings?: ModelSettings;
}

// ───────────────────────── requests ─────────────────────────

/** method -> { params, result } */
export interface Methods {
  "hub.snapshot": { params: Record<string, never>; result: Snapshot };

  "thread.get": { params: { threadId: ThreadId; limit?: number }; result: { thread: Thread; entries: Entry[] } };

  /**
   * Send a user message. In the main thread it goes to the router bot.
   * In a sub-bot thread, `mode` says how it is injected while the bot is busy:
   *   normal    : normal message (starts a turn if idle, else queued like "queue")
   *   steer     : joins the running turn at the next step boundary (Enter while busy)
   *   queue     : handled after the current turn (Alt+Enter)
   *   interrupt : abort current turn, then send (Ctrl/Cmd+Enter)
   */
  "chat.send": {
    params: { threadId: ThreadId; text: string; mode?: "normal" | "steer" | "queue" | "interrupt"; attachments?: string[] };
    result: { entryId: EntryId };
  };

  "task.interrupt": { params: { taskId: TaskId }; result: { ok: true } };
  "task.cancel": { params: { taskId: TaskId }; result: { ok: true } };
  /** Fork a task from a past entry into a NEW task (new worktree/session). */
  "task.fork": {
    params: { taskId: TaskId; entryId: EntryId; label?: string; botId?: BotId };
    result: { task: Task; branch: Branch };
  };
  "task.branches": { params: { taskId: TaskId }; result: { branches: Branch[] } };
  /** Mark a branch as the chosen one (merges nothing by itself in v0 — records the decision). */
  "branch.adopt": { params: { branchId: BranchId }; result: { branch: Branch } };

  "approval.resolve": {
    params: { approvalId: ApprovalId; decision: "allow" | "deny"; remember?: boolean };
    result: { approval: Approval };
  };

  "trigger.list": { params: Record<string, never>; result: { triggers: TriggerRule[] } };
  "trigger.upsert": { params: { trigger: Omit<TriggerRule, "id"> & { id?: TriggerId } }; result: { trigger: TriggerRule } };
  "trigger.delete": { params: { triggerId: TriggerId }; result: { ok: true } };
  /** Fire a trigger now (for the "试跑" button and tests). */
  "trigger.fire": { params: { triggerId: TriggerId; payload?: Record<string, unknown> }; result: { eventId: HubEventId } };

  "event.list": {
    params: { source?: EventSource; limit?: number; before?: Iso };
    result: { events: HubEvent[] };
  };

  "bot.detectAgents": { params: Record<string, never>; result: { agents: DetectedAgent[] } };
  "bot.add": {
    params: {
      name: string;
      kind: Exclude<BotKind, "main">;
      engineLabel?: string;
      color?: BotColor;
      shape?: PebbleShape;
      // phase 2
      tagline?: string;
      persona?: string;
      model?: ModelRef;
      tools?: NativeToolGroup[];
      skills?: string[];
    };
    result: { bot: Bot };
  };
  /** Edit any bot field except id/kind/status/threadId/costWeekUsd/builtin. */
  "bot.update": {
    params: {
      botId: BotId;
      patch: Partial<Pick<Bot, "name" | "engineLabel" | "tagline" | "shape" | "color" | "skills" | "persona" | "model" | "tools">>;
    };
    result: { bot: Bot };
  };
  /** Remove a non-builtin, non-main bot that has no running task. */
  "bot.remove": { params: { botId: BotId }; result: { ok: true } };

  // ── models (phase 2) ──
  /** pi-ai built-in provider catalog (static) + which ones have env keys. */
  "model.catalog": { params: Record<string, never>; result: { providers: ProviderCatalogEntry[] } };
  "model.providers": { params: Record<string, never>; result: { providers: ModelProviderConfig[]; settings: ModelSettings } };
  /** Create/update a provider. `apiKey`: undefined = keep existing, "" = clear, string = set. */
  "model.providerUpsert": {
    params: {
      provider: Omit<ModelProviderConfig, "id" | "hasApiKey" | "createdAt"> & { id?: string };
      apiKey?: string;
    };
    result: { provider: ModelProviderConfig };
  };
  "model.providerDelete": { params: { providerId: string }; result: { ok: true } };
  /** Models of enabled providers (or one provider). May refresh dynamic catalogs. */
  "model.list": { params: { providerId?: string }; result: { models: ModelInfo[] } };
  /** One tiny real request ("reply OK") to verify a model works. */
  "model.test": {
    params: { ref: ModelRef };
    result: { ok: boolean; latencyMs?: number; reply?: string; error?: string };
  };
  "model.settingsSet": { params: { settings: ModelSettings }; result: { settings: ModelSettings } };

  "device.list": { params: Record<string, never>; result: { devices: Device[] } };
  /** v0: returns a 6-digit code; pairing itself is a stub. */
  "device.pairCode": { params: Record<string, never>; result: { code: string; expiresAt: Iso } };
}

export type MethodName = keyof Methods;

export interface WireRequest<M extends MethodName = MethodName> {
  type: "req";
  id: string;
  method: M;
  params: Methods[M]["params"];
}

export interface WireError {
  code: "bad_request" | "not_found" | "conflict" | "busy" | "unsupported" | "internal";
  message: string;
}

export type WireResponse =
  | { type: "res"; id: string; ok: true; result: unknown }
  | { type: "res"; id: string; ok: false; error: WireError };

// ───────────────────────── pushes ─────────────────────────

export type PushPayload =
  | { kind: "bot.updated"; bot: Bot }
  | { kind: "bot.added"; bot: Bot }
  | { kind: "bot.removed"; botId: BotId }
  /** Model providers / settings changed (clients re-fetch `model.providers`). */
  | { kind: "models.changed"; settings: ModelSettings }
  | { kind: "thread.updated"; thread: Thread }
  | { kind: "task.updated"; task: Task }
  | { kind: "entry.appended"; entry: Entry }
  /** Streaming text for an existing `bot` or `thinking` entry (append `delta` to its text). */
  | { kind: "entry.delta"; threadId: ThreadId; entryId: EntryId; delta: string }
  /** Replace an existing entry in place (e.g. streaming finished, steer applied). */
  | { kind: "entry.replaced"; entry: Entry }
  | { kind: "approval.created"; approval: Approval }
  | { kind: "approval.updated"; approval: Approval }
  | { kind: "trigger.updated"; trigger: TriggerRule }
  | { kind: "trigger.deleted"; triggerId: TriggerId }
  | { kind: "event.logged"; event: HubEvent }
  | { kind: "branch.updated"; branch: Branch }
  | { kind: "device.updated"; device: Device };

export interface WirePush {
  type: "push";
  /** Strictly increasing per daemon run, starting at snapshot.seq + 1. */
  seq: number;
  push: PushPayload;
}

export type ServerMessage = WireResponse | WirePush;

// ───────────────────────── helpers ─────────────────────────

export const DEFAULT_PORT = 7788;
export const MAIN_THREAD_ID: ThreadId = "thread-main";
export const MAIN_BOT_ID: BotId = "bot-pip";

export function isPush(m: ServerMessage): m is WirePush {
  return m.type === "push";
}
