// 开发启动：构建壳 -> （若 Vite 未运行则顺手拉起）-> 启动 Electron；Electron 退出后清理 Vite。
import { spawn } from "node:child_process";
import { request } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(here, "..", "web");
const webUrl = process.env.MUSTER_WEB_URL || "http://localhost:5173";
const useDist = webUrl === "dist";

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: "inherit", ...opts });
    c.once("error", reject);
    c.once("exit", (code) => resolve(code ?? 1));
  });

const isUp = (url) =>
  new Promise((resolve) => {
    const req = request(url, { method: "GET", timeout: 1000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });

async function waitUp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isUp(url)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

if ((await run(process.execPath, [join(here, "build.mjs")], { cwd: here })) !== 0) process.exit(1);

let vite = null;
if (!useDist && !(await isUp(webUrl))) {
  console.log("[desktop] Vite 未运行，正在拉起 apps/web 的开发服务器…");
  const viteBin = join(dirname(createRequire(join(webDir, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
  const port = new URL(webUrl).port || "5173";
  vite = spawn(process.execPath, [viteBin, "--port", port, "--strictPort"], { cwd: webDir, stdio: "inherit" });
  if (!(await waitUp(webUrl, 30_000))) console.warn("[desktop] 等待 Vite 超时，仍尝试启动 Electron（会显示错误页）");
}

const electronPath = createRequire(join(here, "package.json"))("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electron = spawn(electronPath, [here], { stdio: "inherit", env });

const cleanup = () => {
  if (vite && !vite.killed) vite.kill();
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => electron.kill());
electron.once("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
