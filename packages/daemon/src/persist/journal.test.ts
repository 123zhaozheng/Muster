import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "@muster/protocol";
import { createHub } from "../core/hub";
import { attachJournal } from "./journal";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "muster-journal-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const task: Task = { id: "task-1", title: "修支付回调", botId: "bot-xiaoma", threadId: "thread-t1", parentThreadId: "thread-main", status: "running", startedAt: "2026-11-06T01:00:00.000Z" };

describe("attachJournal", () => {
  it("persists on close and restores into a fresh hub, keeping seq monotonic", () => {
    const hub = createHub({ dataDir: dir });
    const j = attachJournal(hub, { dataDir: dir });
    hub.commit({ kind: "task.updated", task });
    hub.commit({ kind: "thread.updated", thread: { id: "thread-t1", title: "修支付回调", botId: "bot-xiaoma", taskId: "task-1", createdAt: task.startedAt, updatedAt: task.startedAt } });
    hub.commit({ kind: "entry.appended", entry: { id: "e1", threadId: "thread-t1", ts: task.startedAt, kind: "user", text: "你好" } });
    hub.commit({ kind: "event.logged", event: { id: "ev1", ts: task.startedAt, source: "cron", title: "定时" } });
    j.close();

    const hub2 = createHub({ dataDir: dir });
    const j2 = attachJournal(hub2, { dataDir: dir });
    expect(hub2.model.tasks["task-1"]).toEqual(task);
    expect(hub2.model.entries["thread-t1"]).toHaveLength(1);
    expect(hub2.model.events[0]?.id).toBe("ev1");
    expect(hub2.model.seq).toBe(4);
    expect(hub2.commit({ kind: "task.updated", task: { ...task, status: "done" } }).seq).toBe(5);
    j2.close();
  });

  it("writes on the throttle timer without close() (survives a kill)", async () => {
    const hub = createHub({ dataDir: dir });
    const j = attachJournal(hub, { dataDir: dir });
    hub.commit({ kind: "task.updated", task });
    await new Promise((r) => setTimeout(r, 800));

    // Second journal reads the file while the first is still open (as after a hard kill).
    const hub2 = createHub({ dataDir: dir });
    const j2 = attachJournal(hub2, { dataDir: dir });
    expect(hub2.model.tasks["task-1"]).toBeDefined();
    j2.close();
    j.close();
  });

  it("keeps the seeded state when nothing was ever stored", () => {
    const hub = createHub({ dataDir: dir });
    attachJournal(hub, { dataDir: dir }).close();
    const hub2 = createHub({ dataDir: dir });
    const j = attachJournal(hub2, { dataDir: dir });
    expect(Object.keys(hub2.model.bots)).toContain("bot-pip");
    j.close();
  });
});
