// 守护进程（musterd）的生命周期：选端口、拉起子进程、等待就绪、优雅停止。
// 不依赖 electron，便于单测。
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";

export const DEFAULT_DAEMON_PORT = 7788;

/** 尝试在 127.0.0.1 监听指定端口（0 表示由系统分配），返回实际端口；被占用返回 null。 */
function tryListen(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(null));
    srv.listen(port, "127.0.0.1", () => {
      const addr = srv.address();
      const actual = typeof addr === "object" && addr ? addr.port : null;
      srv.close(() => resolve(actual));
    });
  });
}

/** 优先使用 preferred，被占用时换一个系统分配的空闲端口。 */
export async function findFreePort(preferred = DEFAULT_DAEMON_PORT): Promise<number> {
  const first = await tryListen(preferred);
  if (first !== null) return first;
  const any = await tryListen(0);
  if (any === null) throw new Error("找不到可用端口");
  return any;
}

export const newToken = (): string => randomBytes(24).toString("hex");

/** 对 /health 发一次 GET；服务能应答 HTTP（状态码 < 500）即视为已就绪。 */
function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path: "/health", method: "GET", timeout: 1000 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** 返回 true 表示应放弃等待（例如子进程已退出）。 */
  aborted?: () => boolean;
}

/** 轮询直到 /health 就绪；超时或被中止则返回 false。 */
export async function waitForHealth(port: number, o: WaitOptions = {}): Promise<boolean> {
  const deadline = Date.now() + (o.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    if (o.aborted?.()) return false;
    if (await probeHealth(port)) return true;
    await new Promise((r) => setTimeout(r, o.intervalMs ?? 250));
  }
  return false;
}

export interface DaemonHandle {
  port: number;
  token: string;
  child: ChildProcess;
  /** 子进程已退出时为退出描述，否则为 null。 */
  exited(): string | null;
  stop(): Promise<void>;
}

export interface StartDaemonOptions {
  /** 仓库根目录。 */
  root: string;
  dataDir: string;
  logFile: string;
  fake: boolean;
  /** 覆盖启动命令（测试用）：[可执行文件, ...参数]。 */
  command?: string[];
  /** 子进程工作目录，默认 <root>/packages/daemon（保证 tsx 能从 monorepo 解析）。 */
  cwd?: string;
  preferredPort?: number;
  /** 指定鉴权 token（联调用），默认随机生成。 */
  token?: string;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
}

/** 拉起 daemon 子进程（尚未等待就绪）。 */
export async function startDaemon(o: StartDaemonOptions): Promise<DaemonHandle> {
  const port = await findFreePort(o.preferredPort);
  const token = o.token || newToken();
  mkdirSync(o.dataDir, { recursive: true });
  mkdirSync(join(o.logFile, ".."), { recursive: true });

  const script = join(o.root, "packages", "daemon", "src", "main.ts");
  const [cmd, ...args] = o.command ?? ["node", "--import", "tsx", script];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MUSTER_PORT: String(port),
    MUSTER_TOKEN: token,
    MUSTER_DATA_DIR: o.dataDir,
  };
  if (o.fake) env.MUSTER_FAKE = "1";
  else delete env.MUSTER_FAKE;
  // 若本进程运行在 Electron 中，避免把该变量泄漏给系统 node。
  delete env.ELECTRON_RUN_AS_NODE;

  const log: WriteStream = createWriteStream(o.logFile, { flags: "a" });
  log.write(`\n==== ${new Date().toISOString()} 启动 daemon port=${port} fake=${o.fake} ====\n`);

  const child = spawn(cmd!, args, {
    cwd: o.cwd ?? join(o.root, "packages", "daemon"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });

  let exitInfo: string | null = null;
  let closed!: () => void;
  const closedP = new Promise<void>((r) => (closed = r));
  child.once("error", (e) => {
    exitInfo = `无法启动：${e.message}`;
    log.write(`[desktop] ${exitInfo}\n`);
    closed();
  });
  child.once("exit", (code, signal) => {
    exitInfo = `已退出 code=${code ?? "null"} signal=${signal ?? "null"}`;
    log.write(`[desktop] daemon ${exitInfo}\n`);
    closed();
  });

  return {
    port,
    token,
    child,
    exited: () => exitInfo,
    async stop() {
      if (exitInfo === null) {
        if (process.platform === "win32") {
          // Windows 没有可用的 SIGTERM（kill 即强杀），直接用 taskkill 结束整棵进程树。
          killTree(child);
          await Promise.race([closedP, new Promise((r) => setTimeout(r, 3000))]);
        } else {
          // 先礼后兵：SIGTERM 让 daemon 优雅收尾，3 秒后强杀。
          child.kill("SIGTERM");
          const timer = setTimeout(() => killTree(child), 3000);
          await Promise.race([closedP, new Promise((r) => setTimeout(r, 6000))]);
          clearTimeout(timer);
          if (exitInfo === null) killTree(child);
        }
      }
      await new Promise<void>((r) => log.end(r));
    },
  };
}
