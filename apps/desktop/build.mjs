// 用 esbuild 把主进程与 preload 打包成 CJS（Electron 加载）。
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: { main: join(here, "src/main.ts"), preload: join(here, "src/preload.ts") },
  outdir: join(here, "dist"),
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});
