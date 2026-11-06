// 图标与错误页：均由代码生成，避免引入二进制资源。
import { nativeImage, type NativeImage } from "electron";

/** 生成 size×size 的珊瑚色圆形图标（中间一个白色小圆，像一颗 Pebble）。 */
export function createAppIcon(size = 32): NativeImage {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size * 0.46;
  const inner = size * 0.17;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.max(0, Math.min(1, outer - d + 0.5)); // 1px 抗锯齿
      const white = Math.max(0, Math.min(1, inner - d + 0.5));
      const mix = (coral: number) => Math.round(coral + (255 - coral) * white);
      const o = (y * size + x) * 4;
      // 位图为 BGRA；#ff6b4a
      buf[o] = mix(0x4a);
      buf[o + 1] = mix(0x6b);
      buf[o + 2] = mix(0xff);
      buf[o + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const page = (body: string) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Muster</title><style>
html,body{margin:0;height:100%;background:#fbf8f4;color:#2b2522;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
body{display:flex;align-items:center;justify-content:center;-webkit-app-region:drag}
main{max-width:640px;padding:32px;-webkit-app-region:no-drag}
h1{font-size:20px;margin:0 0 12px}p{color:#6f655e;line-height:1.6;margin:8px 0}
pre{background:#f5efe8;border:1px solid #ece3d9;border-radius:10px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto;color:#2b2522}
.dot{width:28px;height:28px;border-radius:50%;background:#ff6b4a;margin-bottom:16px}
</style></head><body><main><div class="dot"></div>${body}</main></body></html>`;

export const loadingPageUrl = (): string =>
  "data:text/html;charset=utf-8," + encodeURIComponent(page("<h1>正在启动 Muster…</h1><p>正在拉起后台服务，请稍候。</p>"));

/** 启动失败页：给出原因、日志路径与日志末尾片段。 */
export function errorPageUrl(title: string, detail: string, logFile: string, logTail: string): string {
  const html = page(
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><p>日志文件：${escapeHtml(logFile)}</p>` +
      (logTail ? `<pre>${escapeHtml(logTail)}</pre>` : "") +
      "<p>请从托盘图标选择“退出”后重新启动。</p>",
  );
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}
