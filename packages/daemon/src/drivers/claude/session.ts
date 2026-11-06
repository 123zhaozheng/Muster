// OWNER: B4. One Claude Code process = one DriverSession, speaking stream-json both ways.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DriverEvent, DriverSession, SendMode } from "../../core/contracts";
import { ClaudeStreamMapper } from "./mapper";
import { AsyncQueue } from "./queue";

/** The slice of ChildProcess we use; tests substitute a fake. */
export interface ProcLike {
  stdin: { write(chunk: string): unknown; end(): unknown; on?(ev: "error", cb: (e: Error) => void): unknown };
  stdout: { on(ev: "data", cb: (chunk: Buffer | string) => void): unknown };
  stderr?: { on(ev: "data", cb: (chunk: Buffer | string) => void): unknown } | null;
  kill(): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(ev: "close" | "error", cb: (...args: any[]) => void): unknown;
}
export type SpawnFn = (command: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) => ProcLike;

export interface SessionDeps {
  command: string;
  spawn: SpawnFn;
  extraArgs: string[];
  env?: NodeJS.ProcessEnv;
  closeGraceMs: number;
}

const BASE_ARGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--include-partial-messages", "--permission-prompt-tool", "stdio",
];

/** Where Claude Code keeps a session transcript (only the path is computed; the file is never read). */
function sessionFile(cwd: string, id: string): string {
  const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(root, "projects", resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`);
}

export function newSessionArgs(deps: SessionDeps, nativeId: string, model?: string): string[] {
  return [...BASE_ARGS, ...(model ? ["--model", model] : []), ...deps.extraArgs, "--session-id", nativeId];
}

export function resumeSessionArgs(deps: SessionDeps, nativeId: string, model?: string): string[] {
  return [...BASE_ARGS, ...(model ? ["--model", model] : []), ...deps.extraArgs, "--resume", nativeId];
}

export interface SessionInit {
  cwd: string;
  nativeId: string;
  args: string[];
  model?: string;
  /** First user message; written immediately and counts as turn `turnBase + 1`. */
  prompt?: string;
  /** Turns already in the history (non-zero for forks). */
  turnBase?: number;
  /** Assistant message uuids per turn inherited from the parent (so forks of forks work). */
  inheritedUuids?: Map<number, string>;
}

export function createSession(deps: SessionDeps, init: SessionInit): DriverSession {
  const { cwd, nativeId } = init;
  const mapper = new ClaudeStreamMapper({ cwd, turn: init.turnBase });
  for (const [t, u] of init.inheritedUuids ?? []) mapper.lastAssistantUuid.set(t, u);
  const queue = new AsyncQueue<DriverEvent>();
  const decoder = new TextDecoder();
  let lineBuf = "";
  let stderrTail = "";
  let finished = false;
  let closing = false;
  let reqSeq = 0;

  const proc = deps.spawn(deps.command, init.args, { cwd, env: { ...process.env, ...deps.env } });
  let onClosed!: () => void;
  const closed = new Promise<void>((res) => (onClosed = res));

  const write = (obj: unknown) => {
    if (finished) return;
    try {
      proc.stdin.write(`${JSON.stringify(obj)}\n`);
    } catch {
      /* pipe already gone; the close handler reports it */
    }
  };
  const userMessage = (text: string, priority?: "now" | "next" | "later") =>
    write({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
      session_id: "",
      ...(priority ? { priority } : {}),
    });
  const pushAll = (events: DriverEvent[]) => events.forEach((e) => queue.push(e));

  const onLine = (line: string) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // non-JSON noise on stdout
    }
    const m = msg as { type?: string; request_id?: string; request?: { subtype?: string } };
    // Control requests we do not implement must still be answered or the CLI waits forever.
    if (m.type === "control_request" && m.request?.subtype !== "can_use_tool") {
      write({
        type: "control_response",
        response: { subtype: "error", request_id: m.request_id, error: `unsupported control request: ${m.request?.subtype}` },
      });
      return;
    }
    pushAll(mapper.handle(msg));
  };

  const finish = (error?: string) => {
    if (finished) return;
    if (lineBuf) onLine(lineBuf);
    lineBuf = "";
    if (mapper.inTurn) {
      const reason = error ?? `Claude 进程意外退出${stderrTail ? `：${stderrTail.trim().slice(-300)}` : ""}`;
      pushAll(closing ? [{ t: "turn_end", status: "interrupted" }] : [{ t: "turn_end", status: "failed", error: reason }]);
      mapper.inTurn = false;
    }
    finished = true;
    queue.end();
    onClosed();
  };

  proc.stdout.on("data", (chunk) => {
    lineBuf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = lineBuf.indexOf("\n")) >= 0) {
      const line = lineBuf.slice(0, i);
      lineBuf = lineBuf.slice(i + 1);
      onLine(line);
    }
  });
  proc.stderr?.on("data", (chunk) => {
    stderrTail = (stderrTail + (typeof chunk === "string" ? chunk : chunk.toString("utf8"))).slice(-2000);
  });
  proc.stdin.on?.("error", () => {});
  proc.once("error", (e: Error) => finish(`无法启动 Claude Code：${e.message}`));
  proc.once("close", () => finish());

  if (init.prompt !== undefined) {
    pushAll(mapper.beginTurn());
    userMessage(init.prompt);
  }

  const interrupt = async () => {
    if (!mapper.markInterrupt()) return;
    write({ type: "control_request", request_id: `muster-${++reqSeq}`, request: { subtype: "interrupt" } });
  };

  const session: DriverSession = {
    nativeId,
    caps: { steer: true, fork: true, interrupt: true, approvals: true },
    events: queue,

    async send(text, mode: SendMode) {
      if (finished || closing) throw new Error("Claude 会话已关闭");
      const busy = mapper.inTurn;
      if (mode === "interrupt") {
        await interrupt();
        userMessage(text);
      } else if (mode === "steer" && busy) {
        userMessage(text, "next");
        queue.push({ t: "steer_applied", text });
      } else if (mode === "queue" && busy) {
        userMessage(text, "later");
      } else {
        userMessage(text); // idle: steer/queue are just a normal message
      }
    },

    interrupt,

    async resolveApproval(requestId, allow) {
      const p = mapper.pending.get(requestId);
      if (!p) return;
      mapper.pending.delete(requestId);
      write({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: allow ? { behavior: "allow", updatedInput: p.input } : { behavior: "deny", message: "用户拒绝了此操作" },
        },
      });
    },

    async fork(atTurn, opts) {
      const forkCwd = opts?.cwd ?? cwd;
      const at = mapper.lastAssistantUuid.get(atTurn);
      // Transcripts are keyed by cwd: from another directory, point --resume at the file itself.
      const file = sessionFile(cwd, nativeId);
      const source = forkCwd !== cwd && existsSync(file) ? file : nativeId;
      const id = randomUUID();
      const turnBase = at ? atTurn : mapper.turn; // unknown cut point: fork the whole history
      const inherited = new Map([...mapper.lastAssistantUuid].filter(([t]) => t <= turnBase));
      const args = [
        ...BASE_ARGS, ...(init.model ? ["--model", init.model] : []), ...deps.extraArgs,
        "--resume", source, "--fork-session", "--session-id", id, ...(at ? ["--resume-session-at", at] : []),
      ];
      return createSession(deps, { cwd: forkCwd, nativeId: id, args, model: init.model, turnBase, inheritedUuids: inherited });
    },

    async close() {
      if (finished) return;
      closing = true;
      if (mapper.inTurn) write({ type: "control_request", request_id: `muster-${++reqSeq}`, request: { subtype: "interrupt" } });
      try {
        proc.stdin.end();
      } catch {
        /* already closed */
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([closed, new Promise<void>((res) => (timer = setTimeout(res, deps.closeGraceMs)))]);
      clearTimeout(timer);
      if (!finished) {
        proc.kill();
        finish();
      }
    },
  };
  return session;
}
