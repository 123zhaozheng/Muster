/**
 * Pure state model + reducer shared by the daemon hub and the web store, so both sides
 * apply pushes identically. Immutable updates (structural sharing) — safe for React/zustand.
 */
import type {
  Approval, ApprovalId, Bot, BotId, Branch, BranchId, Device, DeviceId, Entry, HubEvent, ModelSettings, PushPayload,
  Snapshot, Task, TaskId, Thread, ThreadId, TriggerId, TriggerRule,
} from "./index";

export interface HubModel {
  seq: number;
  serverTime: string;
  bots: Record<BotId, Bot>;
  threads: Record<ThreadId, Thread>;
  tasks: Record<TaskId, Task>;
  approvals: Record<ApprovalId, Approval>;
  triggers: Record<TriggerId, TriggerRule>;
  devices: Record<DeviceId, Device>;
  branches: Record<BranchId, Branch>;
  /** Loaded entries per thread (oldest first). May be partial until `thread.get` has been merged. */
  entries: Record<ThreadId, Entry[]>;
  /** Newest first, capped at EVENT_CAP. */
  events: HubEvent[];
  /** phase 2. Secrets never live here (provider configs are fetched with `model.providers`). */
  modelSettings: ModelSettings;
}

export const EVENT_CAP = 500;

const byId = <T extends { id: string }>(xs: T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]));

export function emptyModel(): HubModel {
  return { seq: 0, serverTime: new Date(0).toISOString(), bots: {}, threads: {}, tasks: {}, approvals: {}, triggers: {}, devices: {}, branches: {}, entries: {}, events: [], modelSettings: {} };
}

export function modelFromSnapshot(s: Snapshot, prev?: HubModel): HubModel {
  return {
    ...(prev ?? emptyModel()),
    seq: s.seq,
    serverTime: s.serverTime,
    bots: byId(s.bots),
    threads: byId(s.threads),
    tasks: byId(s.tasks),
    approvals: byId(s.approvals),
    triggers: byId(s.triggers),
    devices: byId(s.devices),
    events: [...s.recentEvents].sort((a, b) => (a.ts === b.ts ? 0 : a.ts < b.ts ? 1 : -1)).slice(0, EVENT_CAP),
    modelSettings: s.modelSettings ?? {},
  };
}

export function snapshotOf(m: HubModel): Snapshot {
  return {
    serverTime: m.serverTime,
    seq: m.seq,
    bots: Object.values(m.bots),
    threads: Object.values(m.threads),
    tasks: Object.values(m.tasks),
    approvals: Object.values(m.approvals),
    triggers: Object.values(m.triggers),
    devices: Object.values(m.devices),
    recentEvents: m.events.slice(0, 100),
    modelSettings: m.modelSettings ?? {},
  };
}

/** Merge a `thread.get` result into the model (dedupe by id, keep ts order). */
export function mergeEntries(m: HubModel, threadId: ThreadId, entries: Entry[]): HubModel {
  const cur = m.entries[threadId] ?? [];
  const map = new Map<string, Entry>();
  for (const e of cur) map.set(e.id, e);
  for (const e of entries) map.set(e.id, e);
  const merged = [...map.values()].sort((a, b) => (a.ts === b.ts ? 0 : a.ts < b.ts ? -1 : 1));
  return { ...m, entries: { ...m.entries, [threadId]: merged } };
}

function putEntry(m: HubModel, e: Entry): HubModel {
  const cur = m.entries[e.threadId] ?? [];
  const i = cur.findIndex((x) => x.id === e.id);
  const next = i >= 0 ? cur.map((x, j) => (j === i ? e : x)) : [...cur, e];
  return { ...m, entries: { ...m.entries, [e.threadId]: next } };
}

/** `seq` is advanced by the caller (hub / store), not here. */
export function applyPush(m: HubModel, p: PushPayload): HubModel {
  switch (p.kind) {
    case "bot.updated":
    case "bot.added":
      return { ...m, bots: { ...m.bots, [p.bot.id]: p.bot } };
    case "bot.removed": {
      const { [p.botId]: _gone, ...rest } = m.bots;
      return { ...m, bots: rest };
    }
    case "models.changed":
      return { ...m, modelSettings: p.settings };
    case "thread.updated":
      return { ...m, threads: { ...m.threads, [p.thread.id]: p.thread } };
    case "task.updated":
      return { ...m, tasks: { ...m.tasks, [p.task.id]: p.task } };
    case "entry.appended":
    case "entry.replaced":
      return putEntry(m, p.entry);
    case "entry.delta": {
      const cur = m.entries[p.threadId];
      if (!cur) return m;
      const i = cur.findIndex((x) => x.id === p.entryId);
      const e = cur[i];
      if (i < 0 || !e || (e.kind !== "bot" && e.kind !== "thinking")) return m;
      const next = cur.slice();
      next[i] = { ...e, text: e.text + p.delta };
      return { ...m, entries: { ...m.entries, [p.threadId]: next } };
    }
    case "approval.created":
    case "approval.updated":
      return { ...m, approvals: { ...m.approvals, [p.approval.id]: p.approval } };
    case "trigger.updated":
      return { ...m, triggers: { ...m.triggers, [p.trigger.id]: p.trigger } };
    case "trigger.deleted": {
      const { [p.triggerId]: _gone, ...rest } = m.triggers;
      return { ...m, triggers: rest };
    }
    case "event.logged": {
      if (m.events.some((e) => e.id === p.event.id)) return m;
      return { ...m, events: [p.event, ...m.events].slice(0, EVENT_CAP) };
    }
    case "branch.updated":
      return { ...m, branches: { ...m.branches, [p.branch.id]: p.branch } };
    case "device.updated":
      return { ...m, devices: { ...m.devices, [p.device.id]: p.device } };
  }
}
