// OWNER: B4. Claude Code driver.
//
// Why not @anthropic-ai/claude-agent-sdk: it drives the very same `claude` binary over the same
// stream-json control protocol, but ships/downloads its own platform binary and adds a heavy dependency.
// Spawning the user's already-logged-in `claude` directly needs zero new dependencies, never touches
// credentials, and gives a trivially fakeable process boundary for tests.
import { execFile, spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { DetectedAgent } from "@muster/protocol";
import type { AgentDriver } from "../../core/contracts";
import { createSession, newSessionArgs, resumeSessionArgs, type SessionDeps, type SpawnFn } from "./session";

export type { ProcLike, SpawnFn } from "./session";

export interface ClaudeDriverOptions {
  /** Executable name or absolute path; default "claude" (resolved from PATH). */
  command?: string;
  /** Extra CLI flags for every session, e.g. ["--tools", "Read,Bash"] to restrict tools. */
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  /** Replace process spawning (tests). */
  spawn?: SpawnFn;
  /** How long close() waits for a graceful exit before killing. Default 2000. */
  closeGraceMs?: number;
}

const defaultSpawn: SpawnFn = (command, args, opts) =>
  nodeSpawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }) as unknown as ReturnType<SpawnFn>;

export function createClaudeDriver(o: ClaudeDriverOptions = {}): AgentDriver {
  const command = o.command ?? "claude";
  const deps: SessionDeps = {
    command,
    spawn: o.spawn ?? defaultSpawn,
    extraArgs: o.extraArgs ?? [],
    env: o.env,
    closeGraceMs: o.closeGraceMs ?? 2000,
  };

  return {
    kind: "claude",

    detect(): Promise<DetectedAgent> {
      return new Promise((resolve) => {
        execFile(command, ["--version"], { timeout: 10_000, windowsHide: true, env: { ...process.env, ...o.env } }, (err, stdout) => {
          if (err) return resolve({ engine: "claude", command, found: false });
          const version = /\d+\.\d+\.\d+\S*/.exec(String(stdout))?.[0];
          resolve({ engine: "claude", command, found: true, ...(version ? { version } : {}) });
        });
      });
    },

    async start(opts) {
      const resume = opts.resumeNativeId;
      const nativeId = resume ?? randomUUID();
      const args = resume ? resumeSessionArgs(deps, nativeId, opts.model) : newSessionArgs(deps, nativeId, opts.model);
      return createSession(deps, { cwd: opts.cwd, nativeId, args, model: opts.model, prompt: opts.prompt });
    },
  };
}
