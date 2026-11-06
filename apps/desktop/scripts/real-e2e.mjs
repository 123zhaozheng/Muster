// 桌面端真实模式联调（二期 I3）。
//   node apps/desktop/scripts/real-e2e.mjs [--shots <dir>]
// 前置：已构建 apps/web（dist）与 apps/desktop（node build.mjs）。
// 流程：起假 OpenAI 服务 -> 以真实模式（不设 MUSTER_DESKTOP_FAKE）启动 Electron（带 CDP 调试口、固定 daemon 端口/token）
//   -> WS 配置 provider 与默认模型、新建原生成员 -> 在界面主线派发 -> 等任务完成 -> 逐页截图
//   -> 检查侧栏收起 / Logo / 顶部条与系统控制按钮 -> 关闭到托盘 -> 退出并核对无残留进程。
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const desktopDir = resolve(here, "..");
const WebSocket = createRequire(join(root, "packages", "daemon", "package.json"))("ws");
const electronPath = createRequire(join(desktopDir, "package.json"))("electron");

const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : join(root, "design", "screenshots", "v2");
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { checks: {}, notes: [] };
const check = (name, ok, detail) => {
  report.checks[name] = { ok: !!ok, ...(detail !== undefined ? { detail } : {}) };
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
};

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

function listProcs() {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  try {
    const j = JSON.parse(r.stdout);
    return Array.isArray(j) ? j : [j];
  } catch {
    return [];
  }
}
// 本仓库的 electron（node_modules 下的 electron.exe，含 gpu/renderer 子进程）与 daemon（node ... daemon/src/main.ts）。
const isMine = (p) => {
  const c = p.CommandLine ?? "";
  return (/^electron\.exe$/i.test(p.Name) && /node_modules/i.test(p.ExecutablePath ?? "")) || (/^node(\.exe)?$/i.test(p.Name) && /daemon[\\/]src[\\/]main\.ts/.test(c));
};

// ───────────── CDP ─────────────
async function connectCdp(port) {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page" && /^file:|^http:\/\/localhost/.test(t.url) && !t.url.startsWith("data:"));
    } catch {
      /* 还没起来 */
    }
    if (!target) await sleep(300);
  }
  if (!target) throw new Error("找不到 CDP 页面目标");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  let id = 0;
  const pending = new Map();
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => pending.delete(i) && rej(new Error(`CDP ${method} 超时`)), 8000);
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate 失败");
    return r.result.value;
  };
  return { ws, send, evaluate, target };
}

// ───────────── daemon WS ─────────────
async function connectDaemon(port, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  let id = 0;
  const pending = new Map();
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "res" && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.ok ? res(m.result) : rej(new Error(`${m.error.code}: ${m.error.message}`));
    }
  });
  const req = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = String(++id);
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ type: "req", id: i, method, params }));
    });
  return { ws, req };
}

// ───────────── 主流程 ─────────────
const KEY = "sk-fake-muster-key";
const TOKEN = "e2e-" + Math.random().toString(36).slice(2, 12);
const userData = mkdtempSync(join(tmpdir(), "muster-i3-"));
let fake, electron, cdp, daemon, env;
const before = new Set(listProcs().filter(isMine).map((p) => p.ProcessId));
let exitCode = 0;

try {
  // 1) 假模型服务
  fake = spawn(process.execPath, [join(here, "fake-openai.mjs"), "--port", "0", "--key", KEY], { stdio: ["ignore", "pipe", "inherit"] });
  const fakePort = await new Promise((res, rej) => {
    let buf = "";
    fake.stdout.on("data", (d) => {
      buf += d;
      const m = /LISTENING (\d+)/.exec(buf);
      if (m) res(Number(m[1]));
    });
    fake.once("exit", () => rej(new Error("fake-openai 提前退出")));
  });
  const fakeBase = `http://127.0.0.1:${fakePort}/v1`;
  console.log("fake-openai:", fakeBase);

  // 2) 真实模式启动 Electron
  const daemonPort = await freePort();
  const dbgPort = await freePort();
  env = { ...process.env };
  for (const k of ["ELECTRON_RUN_AS_NODE", "MUSTER_DESKTOP_FAKE", "MUSTER_FAKE", "MUSTER_NATIVE_MODEL", "MUSTER_NATIVE_BASE_URL", "MUSTER_NATIVE_API_KEY", "MUSTER_ROUTER_LLM", "OPENAI_API_KEY"]) delete env[k];
  Object.assign(env, {
    MUSTER_USER_DATA: userData,
    MUSTER_WEB_URL: "dist",
    MUSTER_DESKTOP_DAEMON_PORT: String(daemonPort),
    MUSTER_DESKTOP_DAEMON_TOKEN: TOKEN,
    MUSTER_DESKTOP_DEBUG_PORT: String(dbgPort),
  });
  electron = spawn(electronPath, [desktopDir], { stdio: "ignore", env });
  const electronExited = new Promise((r) => electron.once("exit", (c) => r(c)));

  cdp = await connectCdp(dbgPort);
  daemon = await connectDaemon(daemonPort, TOKEN);
  const snap0 = await daemon.req("hub.snapshot");
  check("真实模式 daemon 已就绪（非 fake）", snap0.bots.some((b) => b.id === "bot-xiaotan"), undefined);
  await sleep(1500);
  const href = await cdp.evaluate("location.href.replace(/token=[^&#]+/, 'token=***')");
  const state0 = await cdp.evaluate(`({ mock: localStorage.getItem('muster.mock'), demo: document.body.innerText.includes('演示模式'), text: document.body.innerText.slice(0, 400) })`);
  check("界面连的是真实 daemon（无演示模式标签）", !state0.demo, { href });
  const shot = async (name, full = false) => {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, `desktop-real-${name}.png`), Buffer.from(r.data, "base64"));
  };
  const goto = async (hash) => {
    await cdp.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    await sleep(1200);
  };

  // 3) 未配置模型时的主线（引导卡）
  await goto("#/");
  await sleep(800);
  await shot("01-home-unconfigured");
  check("未配置模型时主线出现去配置引导", (await cdp.evaluate("document.body.innerText")).includes("配置模型"));

  // 4) 配置 provider（WS）
  const up = await daemon.req("model.providerUpsert", {
    provider: { kind: "openai-compatible", name: "假模型（联调）", baseUrl: fakeBase, enabled: true, modelIds: ["fake-chat", "fake-pro"] },
    apiKey: KEY,
  });
  const pid = up.provider.id;
  check("providerUpsert 返回 hasApiKey 且不含 key", up.provider.hasApiKey === true && !JSON.stringify(up).includes(KEY), { pid });
  const t = await daemon.req("model.test", { ref: { provider: pid, modelId: "fake-chat" } });
  check("model.test 通过", t.ok === true, t);
  const bad = await daemon.req("model.test", { ref: { provider: pid, modelId: "no-such" } });
  check("model.test 对不存在的模型返回 ok:false（不抛错）", bad.ok === false, bad.error);
  await daemon.req("model.settingsSet", { settings: { router: { provider: pid, modelId: "fake-chat" }, native: { provider: pid, modelId: "fake-chat" } } });

  const member = await daemon.req("bot.add", {
    name: "阿原",
    kind: "native",
    shape: "blob",
    color: "lilac",
    tagline: "联调用原生成员",
    persona: "你是阿原，Muster 团队的原生助手。回答简洁，用中文。",
    model: { provider: pid, modelId: "fake-pro" },
    tools: ["files"],
    skills: ["联调", "总结"],
  });
  check("bot.add 原生成员", member.bot.kind === "native" && member.bot.model?.modelId === "fake-pro", member.bot.id);
  await sleep(800);

  // 5) 设置页 / 团队页截图
  await goto("#/settings?tab=models");
  await sleep(800);
  await shot("02-settings-models");
  check("设置·模型页显示已配置的服务商", (await cdp.evaluate("document.body.innerText")).includes("假模型（联调）"));
  await goto("#/crew");
  await sleep(600);
  await shot("03-crew");
  check("团队页出现新成员", (await cdp.evaluate("document.body.innerText")).includes("阿原"));

  // 6) 主线派发（界面输入）
  await goto("#/");
  await sleep(600);
  await cdp.evaluate("document.querySelector('textarea')?.focus()");
  await cdp.send("Input.insertText", { text: "交给阿原总结一下这个项目的目录结构" });
  await sleep(300);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

  let tasks = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const s = await daemon.req("hub.snapshot");
    tasks = s.tasks;
    if (tasks.length && tasks.every((x) => ["done", "failed", "cancelled"].includes(x.status))) break;
    if (tasks.some((x) => x.status === "running")) {
      await sleep(250);
      if (!report.workingShot) {
        report.workingShot = true;
        await shot("04-home-working");
      }
    }
    await sleep(500);
  }
  const task = tasks.find((x) => x.botId === member.bot.id);
  check("任务派给了原生成员并完成", task?.status === "done", task && { status: task.status, progress: task.progress, tokens: task.tokens, costUsd: task.costUsd });
  const thread = task ? await daemon.req("thread.get", { threadId: task.threadId ?? member.bot.threadId }) : { entries: [] };
  const replied = thread.entries.some((e) => e.kind === "bot" && /假模型回复/.test(e.text ?? ""));
  check("原生成员的回复来自配置的模型", replied);
  const stats = await (await fetch(`http://127.0.0.1:${fakePort}/__stats`)).json();
  check("假模型服务收到过原生成员（fake-pro）的请求", stats.models["fake-pro"] >= 1, stats);
  // 第二条消息没有指派词，交给 Pip 的路由模型决定（假模型按名字生成 dispatch 工具调用）
  const nBefore = (await daemon.req("hub.snapshot")).tasks.length;
  await daemon.req("chat.send", { threadId: "thread-main", text: "阿原，你好，顺便介绍一下你自己" });
  const t1 = Date.now();
  let nAfter = nBefore;
  while (Date.now() - t1 < 30_000 && nAfter <= nBefore) {
    await sleep(500);
    nAfter = (await daemon.req("hub.snapshot")).tasks.length;
  }
  const stats2 = await (await fetch(`http://127.0.0.1:${fakePort}/__stats`)).json();
  check("Pip 用路由模型（fake-chat）做了 dispatch 并派出新任务", stats2.dispatch >= 1 && nAfter > nBefore, { dispatch: stats2.dispatch, nBefore, nAfter });
  check("没有未授权请求（key 正确传递）", stats.unauthorized === 0, stats.unauthorized);
  await sleep(1500);
  await goto("#/");
  await sleep(600);
  await shot("05-home-done");
  if (task) {
    await goto(`#/task/${task.id}`);
    await sleep(1200);
    await shot("06-workbench");
  }

  // 7) 外壳检查：侧栏收起 / Logo / 顶部条与标题栏控制按钮
  await goto("#/costs");
  const wide = await cdp.evaluate("document.querySelector('aside, [aria-label=\"侧栏\"]')?.getBoundingClientRect().width");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "b", code: "KeyB", windowsVirtualKeyCode: 66, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "b", code: "KeyB", windowsVirtualKeyCode: 66, modifiers: 2 });
  await sleep(700);
  const narrow = await cdp.evaluate("document.querySelector('aside, [aria-label=\"侧栏\"]')?.getBoundingClientRect().width");
  await shot("07-sidebar-collapsed");
  check("Ctrl+B 收起侧栏（248 -> 72）", wide > 200 && narrow < 100, { wide, narrow });
  await cdp.evaluate("document.querySelector('a[aria-label^=\"Muster\"]')?.click()");
  await sleep(800);
  check("点击 Logo 回到主线", (await cdp.evaluate("location.hash")).replace(/\?.*/, "") === "#/", await cdp.evaluate("location.hash"));
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "b", code: "KeyB", windowsVirtualKeyCode: 66, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "b", code: "KeyB", windowsVirtualKeyCode: 66, modifiers: 2 });
  await sleep(600);

  const tb = await cdp.evaluate(`(() => {
    const h = document.querySelector('header[data-topbar]');
    if (!h) return null;
    const kids = [...h.querySelectorAll('button, a, [role=img]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const right = Math.max(...kids.map((r) => r.right));
    const wco = navigator.windowControlsOverlay;
    const area = wco && wco.visible ? wco.getTitlebarAreaRect() : null;
    return {
      topbarHeight: h.getBoundingClientRect().height,
      rightmostContent: right,
      viewportWidth: innerWidth,
      paddingRight: getComputedStyle(h).paddingRight,
      appRegion: getComputedStyle(h).getPropertyValue('-webkit-app-region'),
      titlebarArea: area && { x: area.x, width: area.width, height: area.height, right: area.x + area.width },
      envRight: getComputedStyle(h).getPropertyValue('--titlebar-right'),
    };
  })()`);
  report.topbar = tb;
  if (process.platform === "win32") {
    check(
      "顶部条右侧内容不被系统控制按钮遮挡",
      tb && tb.titlebarArea && tb.rightmostContent <= tb.titlebarArea.right + 0.5,
      tb,
    );
  }
  check("顶部条是窗口拖拽区", tb && /drag/.test(tb.appRegion), tb?.appRegion);
  await shot("08-topbar");

  // 8) 关闭到托盘：renderer 的 window.close() 走 BrowserWindow 'close' 事件；以 <userData>/logs/desktop.log 为准
  const desktopLog = () => { try { return readFileSync(join(userData, "logs", "desktop.log"), "utf8"); } catch { return ""; } };
  // 向窗口发 WM_CLOSE，与用户点标题栏右上角的 X 等价
  const ps = "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);'; " +
    "Get-Process electron | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like 'Muster*' } | ForEach-Object { [W.U]::PostMessage($_.MainWindowHandle, 0x10, [System.IntPtr]::Zero, [System.IntPtr]::Zero) | Out-Null; $_.Id }";
  const pr = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  report.wmClose = pr.stdout.trim();
  await sleep(1500);
  const log1 = desktopLog();
  check("关闭窗口只是隐藏到托盘（未销毁窗口）", /hidden to tray/.test(log1) && !/window destroyed/.test(log1), log1.trim().split(String.fromCharCode(10)).slice(-2));
  const snapAfterClose = await daemon.req("hub.snapshot").then(() => true).catch(() => false);
  check("关闭窗口后 daemon 仍在运行", snapAfterClose);
  // 再次启动应用 = 唤起窗口（等价于点托盘）
  spawnSync(electronPath, [desktopDir], { env, stdio: "ignore", timeout: 15_000 });
  await sleep(1200);
  const log2 = desktopLog();
  check("再次启动 / 点托盘可唤回窗口", /window show/.test(log2), log2.trim().split(String.fromCharCode(10)).slice(-1));

  // 9) 退出：第二实例带 --quit（等价托盘“退出”），走 before-quit -> 停 daemon -> exit
  const closedAt = Date.now();
  spawnSync(electronPath, [desktopDir, "--quit"], { env, stdio: "ignore", timeout: 15_000 });
  const code = await Promise.race([electronExited, sleep(15_000).then(() => "timeout")]);
  const log3 = desktopLog();
  check("退出：Electron 主进程已结束且 daemon 已停止", code !== "timeout" && /daemon stopped, exit/.test(log3), { code, ms: Date.now() - closedAt });
  const daemonGone = await daemon.req("hub.snapshot").then(() => false).catch(() => true);
  check("退出后 daemon 端口不再应答", daemonGone);
  if (code === "timeout") electron.kill();
} catch (e) {
  exitCode = 1;
  console.error("E2E 异常：", e);
  report.error = String(e?.stack ?? e);
} finally {
  try { daemon?.ws.terminate(); } catch {}
  try { cdp?.ws.terminate(); } catch {}
  await sleep(1500);
  try { fake?.kill(); } catch {}
  if (exitCode && electron?.pid) spawnSync("taskkill", ["/pid", String(electron.pid), "/T", "/F"]); // 异常路径先清理，避免误报残留
  // 残留进程：对比启动前后的 electron（命令行含 muster-i3 的 userData 不一定出现，所以同时按 daemon main.ts 比较）
  const stray = listProcs().filter((p) => isMine(p) && !before.has(p.ProcessId));
  check("退出后无残留 electron / daemon 进程", stray.length === 0, stray.map((p) => `${p.Name}#${p.ProcessId}`));
  for (const p of stray) spawnSync("taskkill", ["/pid", String(p.ProcessId), "/T", "/F"]);
  const failed = Object.entries(report.checks).filter(([, v]) => !v.ok).map(([k]) => k);
  writeFileSync(join(SHOTS, "desktop-real-report.json"), JSON.stringify({ ...report, failed }, null, 2));
  try { rmSync(userData, { recursive: true, force: true }); } catch {}
  console.log(failed.length ? `\n失败项：${failed.join("；")}` : "\n全部通过");
  process.exit(exitCode || (failed.length ? 1 : 0));
}
