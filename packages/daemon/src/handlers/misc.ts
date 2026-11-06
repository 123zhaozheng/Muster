// OWNER: B1. Handlers for: hub.snapshot, thread.get, event.list, device.list, device.pairCode, bot.detectAgents
// (+ bot.add / bot.update / bot.remove, composed from ./bots)
import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import type { DetectedAgent, HubEvent } from "@muster/protocol";
import { EVENT_CAP } from "@muster/protocol/reducer";
import type { DriverRegistry, Handlers, Hub } from "../core/contracts";
import { createBotHandlers } from "./bots";
import { HandlerError } from "./errors";

const PAIR_CODE_TTL_MS = 10 * 60_000;
const DEFAULT_EVENT_LIMIT = 100;

export interface MiscOptions {
  hub: Hub;
  drivers: DriverRegistry;
  /** Override the `opencode` probe (tests). */
  detectOpencode?: () => Promise<DetectedAgent>;
}

/** Probe `opencode --version`; never rejects. */
function probeOpencode(): Promise<DetectedAgent> {
  return new Promise((resolve) => {
    // shell on Windows so that npm-installed `.cmd` shims resolve; the command line is a constant.
    execFile("opencode", ["--version"], { shell: process.platform === "win32", timeout: 5000, windowsHide: true }, (err, stdout) => {
      const version = String(stdout ?? "").trim().split(/\r?\n/)[0] || undefined;
      resolve(err ? { engine: "opencode", command: "opencode", found: false } : { engine: "opencode", command: "opencode", found: true, ...(version ? { version } : {}) });
    });
  });
}

function toEngine(kind: string): DetectedAgent["engine"] {
  return kind === "codex" || kind === "claude" ? kind : "other";
}

function posInt(v: unknown, name: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new HandlerError("bad_request", `${name} 必须是正整数`);
  return v;
}

export function createMiscHandlers(o: MiscOptions): Handlers {
  const { hub, drivers } = o;
  const detectOpencode = o.detectOpencode ?? probeOpencode;

  return {
    "hub.snapshot": async () => hub.snapshot(),

    "thread.get": async (p) => {
      if (typeof p?.threadId !== "string" || !p.threadId) throw new HandlerError("bad_request", "缺少 threadId");
      const limit = posInt(p.limit, "limit");
      const thread = hub.model.threads[p.threadId];
      if (!thread) throw new HandlerError("not_found", `会话不存在：${p.threadId}`);
      const all = hub.model.entries[p.threadId] ?? [];
      return { thread, entries: limit ? all.slice(-limit) : all };
    },

    "event.list": async (p) => {
      const limit = Math.min(posInt(p?.limit, "limit") ?? DEFAULT_EVENT_LIMIT, EVENT_CAP);
      const { source, before } = p ?? {};
      if (before !== undefined && typeof before !== "string") throw new HandlerError("bad_request", "before 必须是 ISO 时间");
      const events: HubEvent[] = [];
      // hub.model.events is newest first.
      for (const e of hub.model.events) {
        if (source && e.source !== source) continue;
        if (before && !(e.ts < before)) continue;
        events.push(e);
        if (events.length >= limit) break;
      }
      return { events };
    },

    "device.list": async () => ({ devices: Object.values(hub.model.devices) }),

    "device.pairCode": async () => ({
      code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      expiresAt: new Date(Date.parse(hub.now()) + PAIR_CODE_TTL_MS).toISOString(),
    }),

    "bot.detectAgents": async () => {
      const fromDrivers = [...drivers.entries()].map(async ([kind, driver]): Promise<DetectedAgent> => {
        try {
          return await driver.detect();
        } catch {
          return { engine: toEngine(kind), command: kind, found: false };
        }
      });
      const opencode = detectOpencode().catch((): DetectedAgent => ({ engine: "opencode", command: "opencode", found: false }));
      return { agents: await Promise.all([...fromDrivers, opencode]) };
    },

    // bot.add / bot.update / bot.remove live in ./bots
    ...createBotHandlers({ hub, drivers }),
  };
}
