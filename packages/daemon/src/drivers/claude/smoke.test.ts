// Real-machine smoke test against the locally installed, already-logged-in `claude`.
// Opt in with MUSTER_REAL_CLAUDE=1 (costs a few cents). MUSTER_REAL_CLAUDE_FORK=1 also exercises fork.
// Runs in an empty temp dir, with only Bash/Read available; every approval request is DENIED, so nothing is written.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DriverEvent, DriverSession } from "../../core/contracts";
import { createClaudeDriver } from "./index";

const enabled = process.env.MUSTER_REAL_CLAUDE === "1";

async function runTurn(s: DriverSession, log: DriverEvent[]): Promise<DriverEvent> {
  for await (const e of s.events) {
    log.push(e);
    if (e.t === "approval") await s.resolveApproval(e.requestId, false);
    if (e.t === "turn_end") return e;
  }
  throw new Error("event stream ended without turn_end");
}
const textOf = (log: DriverEvent[]) => log.flatMap((e) => (e.t === "text_delta" ? [e.delta] : [])).join("");

describe.skipIf(!enabled)("claude driver: real smoke", () => {
  it("detects, runs a turn, and optionally forks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muster-claude-smoke-"));
    const driver = createClaudeDriver({ extraArgs: ["--tools", "Bash,Read"] });
    let s: DriverSession | undefined;
    let f: DriverSession | undefined;
    try {
      const found = await driver.detect();
      console.log("[smoke] detect:", found);
      expect(found.found).toBe(true);

      s = await driver.start({ cwd: dir, prompt: "运行 node --version，然后只回复 OK" });
      const log: DriverEvent[] = [];
      const end = await runTurn(s, log);
      console.log("[smoke] events:", JSON.stringify(log));
      expect(end).toMatchObject({ t: "turn_end", status: "completed" });
      expect(textOf(log)).toContain("OK");
      expect(readdirSync(dir)).toEqual([]); // nothing written

      if (process.env.MUSTER_REAL_CLAUDE_FORK === "1") {
        f = await s.fork(1);
        await f.send("你上一轮回复的是哪两个字母？只回答这两个字母。", "normal");
        const flog: DriverEvent[] = [];
        const fend = await runTurn(f, flog);
        console.log("[smoke] fork events:", JSON.stringify(flog));
        expect(fend).toMatchObject({ t: "turn_end", status: "completed" });
        expect(flog[0]).toEqual({ t: "turn_start", turn: 2 });
        expect(textOf(flog).toUpperCase()).toContain("OK");
      }
    } finally {
      await Promise.all([s?.close(), f?.close()]);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
