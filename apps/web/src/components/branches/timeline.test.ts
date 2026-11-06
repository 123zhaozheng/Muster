import { describe, expect, it } from "vitest";
import type { Branch, Entry } from "@muster/protocol";
import { branches, entriesByThread } from "@muster/protocol/fixtures";
import { BRANCH_TONES, STEP_GAP, buildTimeline, placeBranches, toneOf } from "./timeline";

const entries = entriesByThread["thread-fix-callback"]!;

describe("buildTimeline", () => {
  it("fixtures：7 条 entry 全部成为编号节点，fork 点保留", () => {
    const steps = buildTimeline(entries, new Set(["e-wb-5"]));
    expect(steps).toHaveLength(7);
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(steps.find((s) => s.entryId === "e-wb-5")).toMatchObject({ index: 5, label: "编写代码" });
  });
  it("超过 8 个时压缩，但 fork 点一定在", () => {
    const many: Entry[] = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, threadId: "t", ts: "2026-01-01T00:00:00Z", kind: "bot", botId: "b", text: "hi" }));
    const steps = buildTimeline(many, new Set(["x13"]));
    expect(steps.length).toBeLessThanOrEqual(8);
    expect(steps.some((s) => s.entryId === "x13")).toBe(true);
  });
  it("system 条目被忽略", () => {
    const steps = buildTimeline([{ id: "s", threadId: "t", ts: "", kind: "system", text: "x" }], new Set());
    expect(steps).toEqual([]);
  });
});

describe("placeBranches", () => {
  it("同一 fork 点的分支上下交替，位于 fork 节点右侧", () => {
    const steps = buildTimeline(entries, new Set(["e-wb-5"]));
    const [a, b] = placeBranches(steps, branches);
    expect(a!.fromEntryId).toBe("e-wb-5");
    expect(a!.x).toBe(5 * STEP_GAP + STEP_GAP);
    expect(a!.y).toBeLessThan(b!.y);
  });
  it("找不到 fork entry 时挂到最后一个节点", () => {
    const steps = buildTimeline(entries, new Set());
    const orphan: Branch = { ...branches[0]!, forkEntryId: "missing" };
    expect(placeBranches(steps, [orphan])[0]!.fromEntryId).toBe(steps[steps.length - 1]!.entryId);
  });
  it("toneOf 循环取色", () => {
    expect(toneOf(BRANCH_TONES.length)).toBe(BRANCH_TONES[0]);
  });
});
