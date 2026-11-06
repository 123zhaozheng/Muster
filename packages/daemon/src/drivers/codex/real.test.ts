// Optional real-machine smoke test. Runs only with MUSTER_REAL_CODEX=1 (spends a little ChatGPT quota).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DriverEvent, DriverSession } from "../../core/contracts";
import { createCodexDriver } from "./index";

const enabled = process.env.MUSTER_REAL_CODEX === "1";
const forkEnabled = enabled && process.env.MUSTER_REAL_CODEX_FORK === "1";

async function collectTurn(s: DriverSession, ms = 120_000): Promise<DriverEvent[]> {
  const it = s.events[Symbol.asyncIterator]();
  const got: DriverEvent[] = [];
  const deadline = Date.now() + ms;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("真机冒烟超时：" + JSON.stringify(got));
    const r = await Promise.race([
      it.next(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("真机冒烟超时：" + JSON.stringify(got))), left).unref()),
    ]);
    if (r.done) throw new Error("事件流提前结束：" + JSON.stringify(got));
    got.push(r.value);
    if (r.value.t === "turn_end") return got;
  }
}

describe.skipIf(!enabled)("codex driver (real codex app-server)", () => {
  const dir = mkdtempSync(join(tmpdir(), "muster-real-codex-"));
  const sessions: DriverSession[] = [];
  afterAll(async () => {
    for (const s of sessions) await s.close();
    await new Promise((r) => setTimeout(r, 1500)); // let the killed process tree release the cwd (Windows)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  });

  it("detect 能找到 codex", async () => {
    const d = await createCodexDriver().detect();
    expect(d.found).toBe(true);
    expect(d.version).toBeTruthy();
  });

  it("只回复 OK：收到 text 与 turn_end", async () => {
    const s = await createCodexDriver().start({ cwd: dir, prompt: "只回复 OK，不要读写任何文件，不要运行任何命令。" });
    sessions.push(s);
    const evs = await collectTurn(s);
    console.log("[real-codex] events:", JSON.stringify(evs));
    const text = evs.flatMap((e) => (e.t === "text_delta" ? [e.delta] : [])).join("");
    expect(text.length).toBeGreaterThan(0);
    expect(evs.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });

    if (forkEnabled) {
      const f = await s.fork(1);
      sessions.push(f);
      await f.send("只回复 OK2，不要读写任何文件，不要运行任何命令。", "normal");
      const fevs = await collectTurn(f);
      console.log("[real-codex] fork events:", JSON.stringify(fevs));
      expect(fevs[0]).toEqual({ t: "turn_start", turn: 2 });
      expect(fevs.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });
    }
  }, 240_000);
});
