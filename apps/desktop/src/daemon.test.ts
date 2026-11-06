import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findFreePort, startDaemon, waitForHealth } from "./daemon";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const listen = (): Promise<{ srv: Server; port: number }> =>
  new Promise((resolve) => {
    const srv = createServer((_, res) => res.end("ok"));
    servers.push(srv);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: (srv.address() as { port: number }).port }));
  });

describe("findFreePort", () => {
  it("首选端口空闲时直接使用", async () => {
    const { srv, port } = await listen();
    await new Promise((r) => srv.close(r));
    expect(await findFreePort(port)).toBe(port);
  });

  it("首选端口被占用时换一个端口", async () => {
    const { port } = await listen();
    const got = await findFreePort(port);
    expect(got).not.toBe(port);
    expect(got).toBeGreaterThan(0);
  });
});

describe("waitForHealth", () => {
  it("服务可达时返回 true", async () => {
    const { port } = await listen();
    expect(await waitForHealth(port, { timeoutMs: 2000, intervalMs: 50 })).toBe(true);
  });

  it("超时返回 false", async () => {
    const { srv, port } = await listen();
    await new Promise((r) => srv.close(r));
    expect(await waitForHealth(port, { timeoutMs: 300, intervalMs: 50 })).toBe(false);
  });

  it("aborted 为 true 时立即放弃", async () => {
    const t0 = Date.now();
    expect(await waitForHealth(1, { timeoutMs: 5000, aborted: () => true })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("startDaemon", () => {
  it("传入环境变量、等待就绪并能停止子进程", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muster-desktop-"));
    dirs.push(dir);
    const logFile = join(dir, "logs", "daemon.log");
    const script =
      "const http=require('http');" +
      "http.createServer((q,r)=>r.end('ok')).listen(Number(process.env.MUSTER_PORT),'127.0.0.1',()=>console.log('ENV',process.env.MUSTER_TOKEN,process.env.MUSTER_FAKE,process.env.MUSTER_DATA_DIR));";
    const d = await startDaemon({
      root: dir,
      dataDir: join(dir, "data"),
      logFile,
      fake: true,
      cwd: dir,
      command: [process.execPath, "-e", script],
    });
    expect(await waitForHealth(d.port, { timeoutMs: 10_000, intervalMs: 100, aborted: () => d.exited() !== null })).toBe(true);
    await d.stop();
    expect(d.exited()).not.toBeNull();
    expect(await waitForHealth(d.port, { timeoutMs: 300, intervalMs: 50 })).toBe(false);
    const log = readFileSync(logFile, "utf8");
    expect(log).toContain(`ENV ${d.token} 1 ${join(dir, "data")}`);
  });

  it("子进程提前退出时 exited() 有值", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muster-desktop-"));
    dirs.push(dir);
    const d = await startDaemon({
      root: dir,
      dataDir: join(dir, "data"),
      logFile: join(dir, "logs", "daemon.log"),
      fake: false,
      cwd: dir,
      command: [process.execPath, "-e", "process.exit(3)"],
    });
    const ok = await waitForHealth(d.port, { timeoutMs: 5000, intervalMs: 50, aborted: () => d.exited() !== null });
    expect(ok).toBe(false);
    expect(d.exited()).toContain("code=3");
    await d.stop();
  });
});
