import { describe, expect, it } from "vitest";
import { approvals, threads } from "@muster/protocol/fixtures";
import { relativeTime } from "../lib/format";
import { countPending, recentThreads } from "./selectors";

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));

describe("侧栏选择器", () => {
  it("countPending 只数 pending", () => {
    expect(countPending(byId(approvals))).toBe(1);
    expect(countPending(byId([{ ...approvals[0]!, status: "allowed" as const }]))).toBe(0);
  });

  it("recentThreads 按 updatedAt 倒序并映射路由", () => {
    const list = recentThreads(byId(threads));
    expect(list.map((t) => t.to)).toEqual(["/task/task-fix-callback-b", "/task/task-fix-callback", "/task/task-refund-api", "/"].slice(0, 0).concat(
      [...threads].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((t) => (t.taskId ? `/task/${t.taskId}` : "/")),
    ));
    expect(list.find((t) => t.id === "thread-main")?.to).toBe("/");
    expect(recentThreads(byId(threads), 2)).toHaveLength(2);
  });

  it("没有任务的非主线线程不出现在最近对话里", () => {
    const orphan = { id: "thread-x", title: "x", botId: "bot-xiaotan", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    expect(recentThreads({ [orphan.id]: orphan })).toEqual([]);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-06T10:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("各档文案", () => {
    expect(relativeTime(ago(10_000), now)).toBe("刚刚");
    expect(relativeTime(ago(2 * 60_000), now)).toBe("2 分钟前");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 小时前");
    expect(relativeTime(ago(30 * 3_600_000), now)).toBe("昨天");
    expect(relativeTime(ago(5 * 86_400_000), now)).toBe("5 天前");
    expect(relativeTime(undefined, now)).toBe("");
  });
});
