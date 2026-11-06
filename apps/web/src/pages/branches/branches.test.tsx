import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { seedHub } from "../../components/workbench/testHarness";
import Branches from "./index";

// React Flow 依赖浏览器布局 API，jsdom 里不渲染；树的数据逻辑由 timeline.test.ts 覆盖。
vi.mock("../../components/branches/BranchTree", () => ({
  BranchTree: ({ branches }: { branches: unknown[] }) => <div data-testid="tree">{branches.length}</div>,
}));

function renderAt(path = "/task/task-fix-callback/branches") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/task/:taskId/branches" element={<Branches />} />
        <Route path="/task/:taskId" element={<div>工作台页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const cards = () => screen.getAllByTestId("branch-card");

beforeEach(() => cleanup());

describe("分支页", () => {
  it("渲染 fixtures 的两张分支卡片", async () => {
    const request = seedHub();
    renderAt();
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(request).toHaveBeenCalledWith("task.branches", { taskId: "task-fix-callback" });
    const [a, b] = cards() as [HTMLElement, HTMLElement];
    expect(within(a).getByText("分支 A：队列重试")).toBeTruthy();
    expect(within(a).getByText("在队列失败时进行指数退避重试，提升稳定性。")).toBeTruthy();
    expect(within(a).getByText("推荐")).toBeTruthy();
    expect(within(a).getByText("全部通过")).toBeTruthy();
    expect(within(a).getByText("3 个")).toBeTruthy();
    expect(within(a).getByText("12.4K")).toBeTruthy();
    expect(within(b).getByText("分支 B：幂等键方案")).toBeTruthy();
    expect(within(b).queryByText("推荐")).toBeNull();
    expect(within(b).getByText("2 个失败")).toBeTruthy();
    expect(within(b).getByText("2 个")).toBeTruthy();
    expect(within(b).getByText("11.8K")).toBeTruthy();
    expect(screen.getByTestId("tree").textContent).toBe("2");
  });

  it("并排对比：高亮最优项（A 测试最优，B 文件最少且最省 token）", async () => {
    seedHub();
    renderAt();
    await waitFor(() => expect(cards()).toHaveLength(2));
    const [a, b] = cards() as [HTMLElement, HTMLElement];
    expect(within(a).getByText("最优")).toBeTruthy();
    expect(within(a).queryByText("最少")).toBeNull();
    expect(within(b).getByText("最少")).toBeTruthy();
    expect(within(b).getByText("最省")).toBeTruthy();
    expect(within(a).getByText("比最少多 1 个")).toBeTruthy();
  });

  it("统计卡：分支数 / 推荐 / 已采用", async () => {
    seedHub();
    renderAt();
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.getByText("分支数")).toBeTruthy();
    expect(screen.getByText("推荐分支")).toBeTruthy();
  });

  it("从分支任务进入时同样以根任务的分支为准", async () => {
    const request = seedHub();
    renderAt("/task/task-fix-callback-b/branches");
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(request).toHaveBeenCalledWith("task.branches", { taskId: "task-fix-callback" });
  });

  it("task.branches 失败时没有分支则给出提示，不崩溃", async () => {
    seedHub((m) => { if (m === "task.branches") throw new Error("x"); });
    renderAt();
    await waitFor(() => expect(screen.getByText("还没有分支")).toBeTruthy());
    expect(screen.getByText(/从这里分支/)).toBeTruthy(); // 引导步骤说明怎么创建
    expect(screen.getByRole("link", { name: "去工作台创建分支" }).getAttribute("href")).toBe("/task/task-fix-callback");
  });

  it("“采用此分支”调用 branch.adopt 并标记已采用", async () => {
    const request = seedHub();
    renderAt();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "采用此分支" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("branch.adopt", { branchId: "br-a" }));
    await waitFor(() => expect(within(cards()[0]!).getByRole("button", { name: "已采用" })).toBeTruthy());
    expect(within(cards()[1]!).getByRole("button", { name: "采用此分支" })).toBeTruthy();
  });

  it("“继续这个分支”跳到该分支任务的工作台", async () => {
    seedHub();
    renderAt();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cards()[1]!).getByRole("button", { name: "继续这个分支" }));
    expect(screen.getByText("工作台页")).toBeTruthy();
  });

  it("未知任务显示兜底", () => {
    seedHub();
    renderAt("/task/nope/branches");
    expect(screen.getByText("未找到这个任务")).toBeTruthy();
  });
});
