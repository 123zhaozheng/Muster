/**
 * Internal daemon contracts — FROZEN for this build session. Modules talk only through these.
 * (Wire types live in @muster/protocol.)
 */
import type {
  Bot, BotId, BotKind, DetectedAgent, DiffFile, EntryId, Iso, MethodName, Methods, PushPayload, Risk, Snapshot,
  Task, ThreadId, WirePush,
} from "@muster/protocol";
import type { HubModel } from "@muster/protocol/reducer";

// ───────────────────────── Hub: single in-memory source of truth ─────────────────────────

export interface Hub {
  /** Current state (immutable snapshot object; replaced on every commit). Same reducer as the web store. */
  readonly model: HubModel;
  snapshot(): Snapshot;
  /**
   * The ONLY way to change state: applies the payload with `applyPush` from @muster/protocol/reducer,
   * bumps `model.seq`, and broadcasts. Subscribers (websocket clients, journal) see pushes in seq order.
   */
  commit(payload: PushPayload): WirePush;
  subscribe(cb: (push: WirePush) => void): () => void;
  /** Used by the journal to restore state on startup: replaces the model without broadcasting. */
  load(model: HubModel): void;
  newId(prefix: string): string; // e.g. "task-k3f9a2"
  now(): Iso;
}

// ───────────────────────── Handlers ─────────────────────────

export type Handlers = {
  [M in MethodName]?: (params: Methods[M]["params"]) => Promise<Methods[M]["result"]>;
};

// ───────────────────────── Agent drivers (Codex / Claude / fake / …) ─────────────────────────

export interface DriverCaps {
  /** Can inject text into a running turn (steer). If false the orchestrator degrades to queue. */
  steer: boolean;
  fork: boolean;
  interrupt: boolean;
  approvals: boolean;
}

/** Events a driver session emits, normalised across engines. Strictly ordered. */
export type DriverEvent =
  | { t: "turn_start"; turn: number } // 1-based, increases per user turn
  | { t: "text_delta"; delta: string }
  | { t: "text_done" } // current assistant message finished
  | { t: "tool"; tool: string; kind: "read" | "command" | "edit" | "other"; label: string; ok?: boolean; output?: string }
  | { t: "diff"; files: DiffFile[] }
  | { t: "tests"; passed: number; failed: number }
  /** Engine asks permission. The orchestrator creates an Approval and later calls resolveApproval. */
  | { t: "approval"; requestId: string; title: string; detail?: string; risk: Risk }
  | { t: "steer_applied"; text: string }
  | { t: "turn_end"; status: "completed" | "interrupted" | "failed"; error?: string; usage?: { tokens?: number; costUsd?: number } };

export type SendMode = "normal" | "steer" | "queue" | "interrupt";

export interface DriverSession {
  /** Engine-native session/thread id (persist it to resume after restart). */
  readonly nativeId: string;
  readonly caps: DriverCaps;
  /** Ordered event stream; ends when the session is closed. Iterate it exactly once. */
  readonly events: AsyncIterable<DriverEvent>;
  send(text: string, mode: SendMode): Promise<void>;
  interrupt(): Promise<void>;
  resolveApproval(requestId: string, allow: boolean): Promise<void>;
  /** New independent session whose history is this one's up to the END of `atTurn` (1-based). */
  fork(atTurn: number, opts?: { cwd?: string }): Promise<DriverSession>;
  close(): Promise<void>;
}

export interface StartSessionOpts {
  cwd: string;
  prompt: string; // first user message
  model?: string;
  /** Resume an existing native session instead of starting a new one. */
  resumeNativeId?: string;
  /** phase 2: the bot this session runs as (native drivers read persona / model / tools from it). */
  bot?: Bot;
}

export interface AgentDriver {
  readonly kind: Exclude<BotKind, "main">;
  detect(): Promise<DetectedAgent>;
  start(opts: StartSessionOpts): Promise<DriverSession>;
}

export type DriverRegistry = Map<AgentDriver["kind"], AgentDriver>;

// ───────────────────────── Orchestrator (task lifecycle) ─────────────────────────

export interface StartTaskArgs {
  botId: BotId;
  title: string;
  prompt: string;
  parentThreadId: ThreadId;
  cwd?: string;
  /** Started by a trigger with nobody watching: every approval request is auto-denied (and logged). */
  unattended?: boolean;
  triggerId?: string;
}

export interface Orchestrator {
  startTask(a: StartTaskArgs): Promise<Task>;
  /** Deliver a user message to the sub-bot thread (steer / queue / interrupt / normal). */
  sendToThread(threadId: ThreadId, text: string, mode: SendMode): Promise<EntryId>;
  /** task.interrupt, task.cancel, task.fork, task.branches, branch.adopt, approval.resolve */
  handlers: Handlers;
  /** Called once at startup: re-attach/restore tasks that were running before a restart. */
  recover(): Promise<void>;
  shutdown(): Promise<void>;
}

// ───────────────────────── Model service (phase 2) ─────────────────────────

/**
 * Owns user model configuration on top of pi-ai: providers (built-in catalog or OpenAI/Anthropic-compatible
 * endpoints), API keys (stored in dataDir/credentials.json, never sent to clients), and router/native defaults.
 * Router and native driver get models from here instead of env vars. Env vars remain a fallback.
 */
export interface ModelService {
  /** model.catalog, model.providers, model.providerUpsert, model.providerDelete, model.list, model.test, model.settingsSet */
  handlers: Handlers;
  /** A pi-ai `Models` collection with every enabled provider registered (rebuilt on change). */
  models(): import("@earendil-works/pi-ai/models").Models;
  /** Resolve a ref (or the configured default for `purpose`) to the pi-ai provider id + model id. Undefined = not configured. */
  resolve(ref: ModelRefLike | undefined, purpose: "router" | "native"): { provider: string; modelId: string } | undefined;
  settings(): ModelSettingsLike;
  /** Subscribe to configuration changes (provider added, key changed, defaults changed). */
  onChange(cb: () => void): () => void;
}
export type ModelRefLike = { provider: string; modelId: string };
export type ModelSettingsLike = { router?: ModelRefLike; native?: ModelRefLike };

// ───────────────────────── Router (Pip, the thin main bot) ─────────────────────────

export interface Router {
  /** A user message in the main thread. Appends entries via hub.commit, may call orchestrator.startTask. */
  handleUserMessage(text: string): Promise<EntryId>;
  /** Called when a sub-bot task finishes / fails / needs approval, so Pip can report in the main thread. */
  onTaskEvent(task: Task, kind: "done" | "failed" | "waiting_approval"): Promise<void>;
}

// ───────────────────────── Triggers ─────────────────────────

export interface Triggers {
  /** trigger.list, trigger.upsert, trigger.delete, trigger.fire */
  handlers: Handlers;
  start(): Promise<void>;
  stop(): Promise<void>;
}
