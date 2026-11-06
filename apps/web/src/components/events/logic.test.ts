import { describe, expect, it } from "vitest";
import { events as fixtureEvents, triggers as fixtureTriggers } from "@muster/protocol/fixtures";
import type { HubEvent } from "@muster/protocol";
import { CRON_PRESETS, checkCron, formatFireTime, nextFireOf } from "./cron";
import { computeEventStats } from "./stats";
import { dayLabel, groupByDay, relativeTime } from "./time";

describe("relativeTime", () => {
  const now = Date.parse("2026-11-06T10:00:00Z");
  it("formats minutes, hours and days", () => {
    expect(relativeTime("2026-11-06T09:58:00Z", now)).toBe("2分钟前");
    expect(relativeTime("2026-11-06T07:00:00Z", now)).toBe("3小时前");
    expect(relativeTime("2026-11-04T10:00:00Z", now)).toBe("2天前");
    expect(relativeTime("2026-11-06T10:00:00Z", now)).toBe("刚刚");
  });
});

describe("day grouping", () => {
  const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).toISOString();
  const now = new Date(2026, 10, 6, 15, 0, 0).getTime();

  it("labels today, yesterday and older days", () => {
    expect(dayLabel(at(6, 9), now)).toBe("今天");
    expect(dayLabel(at(5, 23), now)).toBe("昨天");
    expect(dayLabel(at(3, 9), now)).toBe("11月3日 周二");
  });

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

  it("formats fire times in the rule's zone relative to now", () => {
    const now = new Date("2026-11-06T00:00:00Z"); // 08:00 in Shanghai
    expect(formatFireTime(new Date("2026-11-06T01:00:00Z"), "Asia/Shanghai", now)).toBe("今天 09:00");
    expect(formatFireTime(new Date("2026-11-07T01:00:00Z"), "Asia/Shanghai", now)).toBe("明天 09:00");
    expect(formatFireTime(new Date("2026-11-09T01:00:00Z"), "Asia/Shanghai", now)).toBe("11月9日 周一 09:00");
  });
});

describe("computeEventStats", () => {
  const now = new Date(2026, 10, 6, 12, 0, 0).getTime();
  const ev = (id: string, dayOffset: number, extra: Partial<HubEvent> = {}): HubEvent => ({
    id,
    ts: new Date(2026, 10, 6 - dayOffset, 9, 0, 0).toISOString(),
    source: "cron",
    title: id,
    ...extra,
  });

  it("counts today, trend, per-source mix and auto executions", () => {
    const events = [
      ev("a", 0, { triggerId: "tr-brief", status: "delivered" }),
      ev("b", 0, { source: "github", triggerId: "tr-pr", status: "dispatched" }),
      ev("c", 1),
      ev("d", 1),
      ev("old", 30), // outside the 7-day window
    ];
    const s = computeEventStats(events, fixtureTriggers, now);
    expect(s.today).toBe(2);
    expect(s.trend).toBe(0);
    expect(s.daily).toEqual([0, 0, 0, 0, 0, 2, 2]);
    expect(s.bySource).toEqual({ cron: 3, github: 1 });
    expect(s.sourceTotal).toBe(4);
    expect(s.triggerTotal).toBe(3);
    expect(s.triggerEnabled).toBe(3);
    expect(s.autoToday).toBe(1); // tr-brief is auto; tr-pr is ask
  });

  it("has no trend when yesterday was empty", () => {
    expect(computeEventStats([ev("a", 0)], fixtureTriggers, now).trend).toBeUndefined();
    expect(computeEventStats(fixtureEvents, [], now).triggerTotal).toBe(0);
  });
});
