// 联调/冒烟辅助：在已加载的主线页自动发一条消息、等待后截图，并导出页面状态。
// 仅在设置了 MUSTER_DESKTOP_SCREENSHOT 时由 main.ts 调用，正常使用不会触发。
import { BrowserWindow, type WebContents } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SmokeOptions {
  /** 截图 PNG 输出路径；状态报告写到同名 .json。 */
  screenshot: string;
  /** 要在主线发送的消息，空则只截图。 */
  message?: string;
  /** 发送后等待多久再截图（毫秒）。 */
  delayMs: number;
}

export async function runSmoke(wc: WebContents, o: SmokeOptions): Promise<void> {
  await sleep(2500); // 等页面渲染并拉到 snapshot
  if (o.message) {
    await wc.executeJavaScript(`document.querySelector("textarea")?.focus()`);
    await wc.insertText(o.message);
    await sleep(200);
    wc.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  }
  await sleep(o.delayMs);
  const state: Record<string, unknown> = await wc.executeJavaScript(`({
    href: location.href.replace(/token=[^&#]+/, "token=***"),
    mockFlag: localStorage.getItem("muster.mock"),
    demoChip: document.body.innerText.includes("演示模式"),
    connecting: document.body.innerText.includes("正在连接守护进程") || document.body.innerText.includes("连接已断开"),
    text: document.body.innerText.slice(0, 3000),
  })`);
  const image = await wc.capturePage();
  mkdirSync(dirname(o.screenshot), { recursive: true });
  writeFileSync(o.screenshot, image.toPNG());
  // MUSTER_DESKTOP_SMOKE_CLOSE=1：模拟点击关闭按钮，验证窗口只是隐藏（托盘常驻）而没有销毁。
  if (process.env.MUSTER_DESKTOP_SMOKE_CLOSE === "1") {
    const w = BrowserWindow.fromWebContents(wc);
    w?.close();
    await sleep(500);
    state.afterClose = { destroyed: w?.isDestroyed() ?? true, visible: w && !w.isDestroyed() ? w.isVisible() : false };
  }
  writeFileSync(o.screenshot.replace(/\.png$/i, "") + ".json", JSON.stringify(state, null, 2));
}
