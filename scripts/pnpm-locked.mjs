// Serialises pnpm commands across parallel agents so the shared lockfile/node_modules
// are never modified concurrently.   Usage: node scripts/pnpm-locked.mjs add -F @muster/daemon zod
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = join(root, ".pnpm-lock-dir");
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const deadline = Date.now() + 15 * 60_000;
for (;;) {
  try {
    mkdirSync(lock);
    break;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs > 10 * 60_000) rmSync(lock, { recursive: true });
    } catch {}
    if (Date.now() > deadline) {
      console.error("timed out waiting for pnpm lock");
      process.exit(1);
    }
    sleep(1000 + Math.floor(Math.random() * 1500));
  }
}
try {
  const r = spawnSync("pnpm", process.argv.slice(2), { cwd: root, stdio: "inherit", shell: true });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(lock, { recursive: true, force: true });
}
