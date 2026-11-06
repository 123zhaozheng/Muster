import { describe, expect, it } from "vitest";
import { bots as fixtureBots, events as fixtureEvents, tasks as fixtureTasks, triggers as fixtureTriggers, devices as fixtureDevices } from "@muster/protocol/fixtures";
import type { Bot, HubEvent, Task } from "@muster/protocol";
import { CRON_PRESETS, checkCron, describeCron, formatFireAt, nextFireOf } from "./cron";
import { continueTarget, foldEvents } from "./feed";
import { frequencyOf, lastResultOf, nextRunOf, upcomingRuns } from "./schedule";
import { groupByDay } from "./time";

describe("day grouping", () => {
  const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).toISOString();
  const now = new Date(2026, 10, 6, 15, 0, 0).getTime();

  it("groups consecutive events by local calendar day", () => {
    const items = [at(6, 14), at(6, 9), at(5, 20), at(3, 8)].map((ts, i) => ({ ts, id: i }));
    const groups = groupByDay(items, now);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["今天", 2], ["昨天", 1], ["11月3日 周二", 1]]);
  });
});

describe("cron helpers", () => {
  it("previews the next runs of a valid expression", () => {
    const r = checkCron("0 9 * * *", "Asia/Shanghai", 3, new Date("2026-11-06T00:00:00Z"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next.map((d) => d.toISOString())).toEqual(["2026-11-06T01:00:00.000Z", "2026-11-07T01:00:00.000Z", "2026-11-08T01:00:00.000Z"]);
    }
  });

  it("rejects empty, malformed and bad time-zone input", () => {
    expect(checkCron("", "UTC").ok).toBe(false);
    expect(checkCron("not a cron", "UTC").ok).toBe(false);
    expect(checkCron("0 9 * * *", "Mars/Base").ok).toBe(false);
  });

  it("every preset is a valid expression", () => {
    for (const p of CRON_PRESETS) expect(checkCron(p.expr, "Asia/Shanghai").ok, p.label).toBe(true);
  });

  it("computes next fire only for cron rules", () => {
    const from = new Date("2026-11-06T00:00:00Z");
    expect(nextFireOf(fixtureTriggers[1]!, from)?.toISOString()).toBe("2026-11-06T01:00:00.000Z");
    expect(nextFireOf(fixtureTriggers[0]!, from)).toBeNull();
  });

  it("formats fire times with the calendar date in the rule's zone", () => {
    expect(formatFireAt(new Date("2026-11-06T01:00:00Z"), "Asia/Shanghai")).toBe("11月6日 周五 09:00");
    expect(formatFireAt(new Date("2026-11-06T20:00:00Z"), "Asia/Shanghai")).toBe("11月7日 周六 04:00");
    expect(formatFireAt(new Date("2026-11-09T01:00:00Z"), "UTC")).toBe("11月9日 周一 01:00");
  });

  it("describes common expressions in plain language", () => {
    expect(describeCron("0 9 * * *")).toBe("每天 09:00");
    expect(describeCron("0 9 * * 1-5")).toBe("工作日 09:00");
    expect(describeCron("0 10 * * 1")).toBe("每周一 10:00");
    expect(describeCron("0 9 1 * *")).toBe("每月 1 号 09:00");
    expect(describeCron("*/30 * * * *")).toBe("每 30 分钟");
    expect(describeCron("0 * * * *")).toBe("每小时整点");
    expect(describeCron("5 4 * 2 *")).toBe("5 4 * 2 *");
    for (const p of CRON_PRESETS) expect(describeCron(p.expr), p.label).not.toBe(p.expr);
  });
});

describe("schedule helpers", () => {
  const brief = fixtureTriggers[1]!;
  const pr = fixtureTriggers[0]!;
  const from = new Date("2026-11-06T00:00:00Z");

  it("gives timed rules a dated next run with the time zone, others a sentence", () => {
    expect(nextRunOf(brief, from)).toMatchObject({ text: "11月6日 周五 09:00", tz: "Asia/Shanghai" });
    expect(nextRunOf(pr, from)).toEqual({ text: "有事件时触发" });
    expect(nextRunOf({ ...brief, enabled: false }, from)).toEqual({ text: "已停用" });
    expect(nextRunOf({ ...brief, params: { expr: "nope", tz: "UTC" } }, from).text).toBe("表达式无效");
  });

  it("describes what fires a rule", () => {
    const devices = Object.fromEntries(fixtureDevices.map((d) => [d.id, d]));
    expect(frequencyOf(brief, devices)).toBe("每天 09:00");
    expect(frequencyOf(pr, devices)).toBe("shop-api · PR 打开");
    expect(frequencyOf(fixtureTriggers[2]!, devices)).toBe("书房台式机 上线时");
  });

  it("reads the last result from the newest matching event", () => {
    const now = Date.parse(fixtureEvents[0]!.ts) + 5 * 60_000;
    expect(lastResultOf(pr, fixtureEvents, now)).toEqual({ text: "已记录 · 5 分钟前", tone: "neutral" });
    expect(lastResultOf(brief, fixtureEvents, now).tone).toBe("success");
    expect(lastResultOf(fixtureTriggers[2]!, [], now)).toEqual({ text: "尚未触发", tone: "neutral" });
  });

  it("lists upcoming timed runs soonest first, capped", () => {
    const hourly = { ...brief, id: "tr-h", label: "hourly", params: { expr: "30 * * * *", tz: "UTC" } };
    const list = upcomingRuns([brief, pr, hourly], from.getTime(), 3);
    expect(list.map((x) => x.trigger.id)).toEqual(["tr-h", "tr-brief"]);
    expect(upcomingRuns([brief, hourly], from.getTime(), 1)).toHaveLength(1);
  });
});

describe("feed", () => {
  const ev = (id: string, extra: Partial<HubEvent> = {}): HubEvent => ({ id, ts: "2026-11-06T09:00:00Z", source: "cron", title: "定时", triggerId: "tr-brief", ...extra });

  it("folds three or more consecutive look-alike events and leaves the rest alone", () => {
    const items = foldEvents([ev("a"), ev("b"), ev("c"), ev("d", { source: "github", triggerId: "tr-pr" }), ev("e"), ev("f")]);
    expect(items.map((i) => (i.kind === "run" ? `run:${i.events.length}` : `one:${i.event.id}`))).toEqual(["run:3", "one:d", "one:e", "one:f"]);
  });

  it("continues in the event's task, Pip's main thread, or the member's latest task", () => {
    const bots = Object.fromEntries(fixtureBots.map((b: Bot) => [b.id, b]));
    const tasks = Object.fromEntries(fixtureTasks.map((t: Task) => [t.id, t]));
    expect(continueTarget({ taskId: "task-fix-callback" }, bots, tasks)).toBe("/task/task-fix-callback");
    expect(continueTarget({ botId: "bot-pip" }, bots, tasks)).toBe("/");
    expect(continueTarget({ botId: "bot-ake" }, bots, tasks)).toBe("/task/task-refund-api");
    expect(continueTarget({ botId: "bot-xiaotan" }, bots, tasks)).toBeNull();
    expect(continueTarget({}, bots, tasks)).toBeNull();
  });
});
