import { describe, expect, it } from "vitest";
import { BOT_STATUS, TASK_STATUS, compareTasks, describeWork, isActiveTask, summarizeWork, taskNeedsYou } from "./status";

const t = (id: string, status: keyof typeof TASK_STATUS, startedAt = "2026-11-06T10:00:00Z") => ({ id, status, startedAt });

describe("状态映射", () => {
  it("任务状态：文案与色调；暂停不存在", () => {
    expect(TASK_STATUS.waiting_approval).toMatchObject({ label: "等你确认", tone: "warning" });
    expect(TASK_STATUS.running).toMatchObject({ label: "执行中", tone: "accent" });
    expect(TASK_STATUS.done).toMatchObject({ label: "已完成", tone: "success" });
    expect(TASK_STATUS.failed).toMatchObject({ label: "失败", tone: "danger" });
    expect(Object.keys(TASK_STATUS)).toHaveLength(6);
  });

  it("成员状态：每个 bot.status 都有文案", () => {
    expect(BOT_STATUS.waiting_approval.label).toBe("等你确认");
    expect(BOT_STATUS.sleeping.label).toBe("休息中");
    expect(BOT_STATUS.working.tone).toBe("accent");
  });

  it("进行中不含等待确认与已完成", () => {
    expect(isActiveTask("running")).toBe(true);
    expect(isActiveTask("queued")).toBe(true);
    expect(isActiveTask("waiting_approval")).toBe(false);
    expect(isActiveTask("done")).toBe(false);
    expect(taskNeedsYou("waiting_approval")).toBe(true);
  });

  it("排序：等你确认 > 执行中 > 排队 > 失败 > 完成 > 取消，同状态新的在前", () => {
    const list = [t("a", "cancelled"), t("b", "done"), t("c", "failed"), t("d", "queued"), t("e", "running", "2026-11-06T09:00:00Z"), t("f", "running"), t("g", "waiting_approval")];
    expect([...list].sort(compareTasks).map((x) => x.id)).toEqual(["g", "f", "e", "d", "c", "b", "a"]);
  });

  it("summarizeWork：待确认的任务与其审批只算一次，且不同时算进行中", () => {
    const tasks = [t("t1", "running"), t("t2", "waiting_approval"), t("t3", "done"), t("t4", "running")];
    const approvals = [
      { id: "a1", taskId: "t2", status: "pending" as const },
      { id: "a2", taskId: "t4", status: "pending" as const },
      { id: "a3", taskId: undefined, status: "pending" as const },
      { id: "a4", taskId: "t1", status: "allowed" as const },
    ];
    expect(summarizeWork(tasks, approvals)).toEqual({ active: 1, needsYou: 3 });
    expect(summarizeWork(tasks)).toEqual({ active: 2, needsYou: 1 });
  });

  it("describeWork：只报告真实存在的部分", () => {
    expect(describeWork({ active: 1, needsYou: 1 })).toBe("1 项进行中 · 1 项等你确认");
    expect(describeWork({ active: 0, needsYou: 2 })).toBe("2 项等你确认");
    expect(describeWork({ active: 0, needsYou: 0 })).toBeNull();
  });
});
