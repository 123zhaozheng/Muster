// JSON-RPC over stdio (one JSON object per line) to a child `codex app-server`.
// The wire omits the "jsonrpc" field; we neither send nor require it.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";

export type RpcId = string | number;

export interface RpcServerRequest {
  id: RpcId;
  method: string;
  params: any;
}

export interface RpcNotification {
  method: string;
  params: any;
}

/** Debug aid: MUSTER_CODEX_TRACE=<file> appends every wire line there. */
function trace(dir: ">" | "<", line: string): void {
  const f = process.env.MUSTER_CODEX_TRACE;
  if (f) try { appendFileSync(f, `${dir} ${line}\n`); } catch { /* ignore */ }
}

export class RpcError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: unknown) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcHandlers {
  onNotification(n: RpcNotification): void;
  onServerRequest(r: RpcServerRequest): void;
  /** Process ended (or failed to spawn). Called at most once. */
  onExit(info: { code: number | null; error?: string }): void;
}

const IS_WIN = process.platform === "win32";

/** On Windows, `codex` is an npm shim (codex.cmd) and must go through the shell; real .exe files need not. */
function needsShell(command: string): boolean {
  return IS_WIN && !/\.exe$/i.test(command);
}

function quote(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

export interface RpcConnectionOpts {
  command: string;
  args: string[];
  cwd?: string;
  requestTimeoutMs?: number;
}

export class RpcConnection {
  private readonly child: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<RpcId, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buf = "";
  private exited = false;
  private stderrTail = "";
  private readonly timeoutMs: number;

  constructor(opts: RpcConnectionOpts, private readonly h: RpcHandlers) {
    this.timeoutMs = opts.requestTimeoutMs ?? 60_000;
    const shell = needsShell(opts.command);
    this.child = shell
      ? spawn([opts.command, ...opts.args].map(quote).join(" "), { cwd: opts.cwd, shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
      : spawn(opts.command, opts.args, { cwd: opts.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });
    this.child.stdin!.on("error", () => { /* process gone; surfaced via exit */ });
    this.child.on("error", (e) => this.finish(null, e.message));
    this.child.on("close", (code) => this.finish(code));
  }

  get stderr(): string {
    return this.stderrTail.trim();
  }

  get alive(): boolean {
    return !this.exited;
  }

  /**
   * `onResult` runs synchronously when the response line is parsed, i.e. before any notification that
   * follows it on the wire is handled (an `await` continuation would run too late to keep event order).
   */
  request<T = any>(method: string, params?: unknown, onResult?: (result: T) => void): Promise<T> {
    if (this.exited) return Promise.reject(new RpcError("codex app-server 已退出"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(`请求超时：${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: (v) => { onResult?.(v); resolve(v); }, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: RpcId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: RpcId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  /** Kill the process tree. Safe to call repeatedly. */
  kill(): void {
    if (this.exited) return;
    const pid = this.child.pid;
    try { this.child.stdin!.end(); } catch { /* ignore */ }
    if (IS_WIN && pid) {
      // shell:true leaves a cmd.exe -> node -> codex.exe chain; kill the whole tree.
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => { /* best effort */ });
    } else {
      this.child.kill();
    }
  }

  private write(msg: Record<string, unknown>): void {
    if (this.exited || !this.child.stdin!.writable) return;
    const line = JSON.stringify(msg);
    trace(">", line);
    this.child.stdin!.write(line + "\n");
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    trace("<", line);
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; /* non-JSON noise */ }
    if (!msg || typeof msg !== "object") return;
    const hasId = msg.id !== undefined && msg.id !== null;
    if (typeof msg.method === "string") {
      if (hasId) this.h.onServerRequest({ id: msg.id, method: msg.method, params: msg.params });
      else this.h.onNotification({ method: msg.method, params: msg.params });
      return;
    }
    if (hasId) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new RpcError(String(msg.error.message ?? "RPC 错误"), msg.error.code, msg.error.data));
      else p.resolve(msg.result);
    }
  }

  private finish(code: number | null, error?: string): void {
    if (this.exited) return;
    this.exited = true;
    const why = error ?? (this.stderrTail.trim() || `进程退出（code=${code}）`);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RpcError(`codex app-server 已退出：${why}`));
    }
    this.pending.clear();
    this.h.onExit({ code, error: error ?? (code === 0 ? undefined : why) });
  }
}

/** Run `<command> --version` and return the trimmed first line, or null if it fails. */
export function runVersion(command: string, timeoutMs = 10_000): Promise<string | null> {
  return new Promise((resolve) => {
    const cb = (err: Error | null, stdout: string) => {
      const line = String(stdout ?? "").split(/\r?\n/).find((l) => l.trim());
      resolve(err || !line ? null : line.trim());
    };
    if (needsShell(command)) {
      execFile(quote(command) + " --version", { shell: true, timeout: timeoutMs, windowsHide: true }, cb);
    } else {
      execFile(command, ["--version"], { timeout: timeoutMs, windowsHide: true }, cb);
    }
  });
}
