// Muster 桌面壳主进程：拉起 musterd、承载 Web UI、托盘常驻。
import { app, BrowserWindow, Menu, shell, Tray } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startDaemon, waitForHealth, type DaemonHandle } from "./daemon";
import { createAppIcon, errorPageUrl, loadingPageUrl } from "./assets";
import { runSmoke } from "./smoke";

const ROOT = resolve(__dirname, "..", "..", ".."); // dist -> desktop -> apps -> 仓库根
// 打包后（或 MUSTER_WEB_URL=dist）加载 ../web/dist/index.html，开发模式默认连 Vite。
const USE_DIST = app.isPackaged || process.env.MUSTER_WEB_URL === "dist";
const WEB_URL = USE_DIST ? "" : process.env.MUSTER_WEB_URL || "http://localhost:5173";
const WEB_DIST = join(ROOT, "apps", "web", "dist", "index.html");
const HEALTH_TIMEOUT_MS = 20_000;
const CANVAS = "#fbf8f4";
// 与 Web 顶部条（apps/web/src/shell/TopBar.tsx，h-14）等高，系统窗口控制按钮正好落在顶部条右端。
const TOPBAR_HEIGHT = 56;

// 联调用：开放 CDP 端口，便于脚本驱动界面、截图（仅监听回环地址）。
if (process.env.MUSTER_DESKTOP_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.MUSTER_DESKTOP_DEBUG_PORT);
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}

app.setName("Muster");
if (process.env.MUSTER_USER_DATA) app.setPath("userData", process.env.MUSTER_USER_DATA);
else app.setPath("userData", join(app.getPath("appData"), "Muster"));

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let daemon: DaemonHandle | null = null;
let quitting = false;
let logFile = "";

/** 生命周期日志（<userData>/logs/desktop.log），联调脚本据此核对“关闭到托盘 / 退出”。 */
function dlog(msg: string): void {
  try {
    const f = join(app.getPath("userData"), "logs", "desktop.log");
    mkdirSync(join(f, ".."), { recursive: true });
    appendFileSync(f, `${new Date().toISOString()} ${msg}
`);
  } catch {
    /* 日志失败不影响使用 */
  }
}

function showWindow(): void {
  if (!win) return;
  dlog("window show");
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function isExternal(url: string, appOrigin: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "data:" || u.protocol === "file:") return false;
    return u.origin !== appOrigin;
  } catch {
    return false;
  }
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === "darwin";
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: CANVAS,
    title: "Muster",
    icon: createAppIcon(64),
    show: false,
    ...(isMac
      ? { titleBarStyle: "hiddenInset" as const }
      : { titleBarStyle: "hidden" as const, titleBarOverlay: { color: CANVAS, symbolColor: "#2b2522", height: TOPBAR_HEIGHT } }),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.setMenuBarVisibility(false);
  w.once("ready-to-show", () => w.show());

  // 外部链接交给系统浏览器，窗口内不再新开。
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (isExternal(url, WEB_URL ? new URL(WEB_URL).origin : "")) {
      e.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  // 关闭 = 隐藏到托盘，daemon 继续运行。
  w.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
      dlog("window close -> hidden to tray");
    }
  });
  w.on("closed", () => {
    dlog("window destroyed");
    win = null;
  });
  // 主框架加载失败（例如 Vite 没启动）时显示错误页。
  w.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED */ || url.startsWith("data:")) return;
    void w.loadURL(
      errorPageUrl("界面加载失败", `无法加载 ${url}（${desc}）。开发模式下请先在另一个终端运行 pnpm web。`, logFile, tailLog()),
    );
  });
  return w;
}

function createTray(): void {
  tray = new Tray(createAppIcon(32));
  tray.setToolTip("Muster");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: showWindow },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ]),
  );
  tray.on("click", showWindow);
}

function tailLog(max = 2000): string {
  try {
    const text = readFileSync(logFile, "utf8");
    return text.length > max ? "…" + text.slice(-max) : text;
  } catch {
    return "";
  }
}

async function boot(): Promise<void> {
  // 冒烟测试用：MUSTER_DESKTOP_EXIT_AFTER_MS 毫秒后走正常退出流程。
  const exitAfter = Number(process.env.MUSTER_DESKTOP_EXIT_AFTER_MS);
  if (exitAfter > 0) setTimeout(() => app.quit(), exitAfter);
  const userData = app.getPath("userData");
  logFile = join(userData, "logs", "daemon.log");
  createTray();
  win = createWindow();
  void win.loadURL(loadingPageUrl());

  try {
    daemon = await startDaemon({
      root: ROOT,
      dataDir: join(userData, "data"),
      logFile,
      fake: process.env.MUSTER_DESKTOP_FAKE === "1",
      // 联调用：固定 daemon 端口 / token，让外部脚本也能连上同一个 daemon。
      preferredPort: Number(process.env.MUSTER_DESKTOP_DAEMON_PORT) || undefined,
      token: process.env.MUSTER_DESKTOP_DAEMON_TOKEN || undefined,
    });
  } catch (e) {
    await win.loadURL(errorPageUrl("后台服务启动失败", (e as Error).message, logFile, tailLog()));
    return;
  }

  const d = daemon;
  if (quitting) {
    // 启动过程中用户已选择退出：before-quit 时 daemon 尚未赋值，这里补停。
    await d.stop();
    app.exit(0);
    return;
  }
  const ready = await waitForHealth(d.port, { timeoutMs: HEALTH_TIMEOUT_MS, aborted: () => d.exited() !== null });
  if (quitting || !win) return;
  if (!ready) {
    const why = d.exited() ? `后台服务${d.exited()}` : `后台服务在 ${HEALTH_TIMEOUT_MS / 1000} 秒内没有就绪`;
    await win.loadURL(errorPageUrl("后台服务未能启动", why, logFile, tailLog()));
    return;
  }

  const daemonWs = `ws://127.0.0.1:${d.port}/ws`;
  if (USE_DIST) {
    if (!existsSync(WEB_DIST)) {
      await win.loadURL(errorPageUrl("界面未构建", `找不到 ${WEB_DIST}，请先运行 pnpm -F @muster/web build。`, logFile, ""));
      return;
    }
    await win.loadFile(WEB_DIST, { query: { daemon: daemonWs, token: d.token } });
  } else {
    const web = new URL(WEB_URL);
    web.searchParams.set("daemon", daemonWs);
    web.searchParams.set("token", d.token);
    await win.loadURL(web.toString());
  }

  // 联调截图（可选）：MUSTER_DESKTOP_SCREENSHOT=<png 路径> [MUSTER_DESKTOP_SMOKE_MESSAGE=<主线消息>]
  const shot = process.env.MUSTER_DESKTOP_SCREENSHOT;
  if (shot && win) {
    const delayMs = Number(process.env.MUSTER_DESKTOP_SCREENSHOT_DELAY_MS) || 6000;
    void runSmoke(win.webContents, { screenshot: shot, message: process.env.MUSTER_DESKTOP_SMOKE_MESSAGE, delayMs }).catch((e) =>
      console.error("[desktop] smoke 失败：", e),
    );
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 再次启动：默认唤起窗口；带 --quit 则正常退出（脚本 / 联调用，等价于托盘“退出”）。
  app.on("second-instance", (_e, argv) => {
    if (argv.includes("--quit")) {
      dlog("quit requested by second instance");
      app.quit();
    } else showWindow();
  });
  app.on("window-all-closed", () => {
    /* 常驻托盘，不退出 */
  });
  app.on("before-quit", (e) => {
    quitting = true;
    dlog("before-quit");
    if (daemon) {
      // 先停 daemon 再真正退出，确保没有残留进程。
      e.preventDefault();
      const d = daemon;
      daemon = null;
      void d.stop().finally(() => {
        dlog("daemon stopped, exit");
        app.exit(0);
      });
    }
  });
  void app.whenReady().then(boot);
}
