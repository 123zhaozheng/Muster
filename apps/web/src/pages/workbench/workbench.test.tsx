import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useHub } from "../../lib/hub";
import { seedHub } from "../../components/workbench/testHarness";
import Workbench from "./index";

function renderAt(path = "/task/task-fix-callback") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>主线页</div>} />
        <Route path="/task/:taskId" element={<Workbench />} />
        <Route path="/task/:taskId/branches" element={<div>分支页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const box = () => screen.getByPlaceholderText("给小码插话…") as HTMLTextAreaElement;
function type(text: string, key: Record<string, unknown> = { key: "Enter" }) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), key);
}

beforeEach(() => cleanup());

describe("工作台渲染 thread-fix-callback", () => {
  beforeEach(() => void seedHub());

  it("头部：名字、引擎、模型、状态、git 分支、目录、指标", () => {
    renderAt();
    expect(screen.getByText("小码", { selector: "div" })).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("默认模型")).toBeTruthy(); // fixtures 的 Bot 没有单独指定模型
    expect(screen.getByText("工作中")).toBeTruthy();
    expect(screen.getByText("muster/fix-callback")).toBeTruthy();
    expect(screen.getByText("D:/work/shop-api")).toBeTruthy();
    expect(screen.getByText(/任务：修支付回调 bug/)).toBeTruthy();
    expect(screen.getByText("84.2K")).toBeTruthy();
    expect(screen.getByText("$0.41")).toBeTruthy();
  });

  it("运行中显示“小码正在工作…”打字指示", () => {
    renderAt();
    expect(screen.getByTestId("typing-indicator").textContent).toContain("小码正在");
  });

  it("对话：bot 文本、折叠工具行、插话高亮、测试结果、diff 文件", () => {
    renderAt();
    expect(screen.getByText(/我来修复支付回调的兼容性问题/)).toBeTruthy();
    expect(screen.getByText("读取了 6 个文件 · 运行了 2 条命令")).toBeTruthy();
    expect(screen.getByText("读取了 4 个文件 · 运行了 1 条命令 · 修改了 1 个文件")).toBeTruthy();
    expect(screen.getByTestId("steer-label").textContent).toBe("已采纳");
    expect(screen.getByText("回调要兼容旧签名")).toBeTruthy();
    expect(screen.getByTestId("test-result").textContent).toContain("12 通过 · 0 失败");
    expect(screen.getByTestId("test-summary").textContent).toContain("12 通过 · 0 失败");
    // 右栏默认“改动”：统一 diff
    expect(screen.getByTestId("diff-view").querySelectorAll("[data-line=add]").length).toBe(3);
    expect(screen.getByTestId("diff-view").querySelectorAll("[data-line=del]").length).toBe(3);
  });

  it("点击工具行展开 items；终端标签汇总命令；日志标签显示该任务事件", () => {
    renderAt();
    const row = screen.getByText("读取了 6 个文件 · 运行了 2 条命令").closest("button")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("pnpm test", { selector: "span" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /终端/ }));
    expect(within(screen.getByTestId("terminal")).getByText("pnpm test")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /日志/ }));
    expect(screen.getByText("回调 · 小码 完成了 修支付回调")).toBeTruthy();
    expect(screen.getByText("任务开始")).toBeTruthy();
  });

  it("概览标签：任务信息、成本、分支入口", () => {
    renderAt();
    fireEvent.click(screen.getByRole("tab", { name: /概览/ }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("工作目录")).toBeTruthy();
    expect(within(panel).getByText("muster/fix-callback")).toBeTruthy();
    expect(within(panel).getByText("84.2K")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "查看分支树" }).getAttribute("href")).toBe("/task/task-fix-callback/branches");
  });

  it("改动标签：文件树选择文件", () => {
    renderAt();
    const tree = screen.getByRole("tree", { name: "改动文件" });
    expect(within(tree).getByText("callback.ts")).toBeTruthy();
    expect(within(tree).getByText("payment")).toBeTruthy();
  });

  it("点击 diff 卡片的文件会在右栏打开改动", () => {
    renderAt();
    fireEvent.click(screen.getByRole("tab", { name: /日志/ }));
    const card = document.querySelector('[data-entry-id="e-wb-6"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /callback\.ts/}));
    expect(screen.getByTestId("diff-view")).toBeTruthy();
  });

  it("未知任务显示兜底", () => {
    renderAt("/task/nope");
    expect(screen.getByText("未找到这个任务")).toBeTruthy();
  });
});

describe("输入框快捷键 -> chat.send mode", () => {
  it("运行中：Enter=steer / Alt+Enter=queue / Ctrl+Enter=interrupt / Cmd+Enter=interrupt", async () => {
    const request = seedHub();
    renderAt();
    const cases: [Record<string, unknown>, string][] = [
      [{ key: "Enter" }, "steer"],
      [{ key: "Enter", altKey: true }, "queue"],
      [{ key: "Enter", ctrlKey: true }, "interrupt"],
      [{ key: "Enter", metaKey: true }, "interrupt"],
    ];
    for (const [key, mode] of cases) {
      request.mockClear();
      type("先看旧签名", key);
      await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", { threadId: "thread-fix-callback", text: "先看旧签名", mode }));
      await waitFor(() => expect(box().value).toBe("")); // 发送成功后清空
    }
  });

  it("Shift+Enter 与空文本不发送；失败时保留文本", async () => {
    const request = seedHub((m) => { if (m === "chat.send") throw new Error("boom"); });
    renderAt();
    type("x", { key: "Enter", shiftKey: true });
    type("", { key: "Enter" });
    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    type("hello");
    await waitFor(() => expect(screen.getByText(/发送失败：boom/)).toBeTruthy());
    expect(box().value).toBe("hello");
  });

  it("分段按钮：选择 排队 / 打断 后点发送；发完恢复为插话", async () => {
    const request = seedHub();
    renderAt();
    expect(screen.getByRole("radio", { name: "插话" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(box(), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("radio", { name: "排队" }));
    expect(screen.getByRole("radio", { name: "排队" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ mode: "queue" })));
    await waitFor(() => expect(box().value).toBe(""));
    expect(screen.getByRole("radio", { name: "插话" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(box(), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("radio", { name: "打断" }));
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ text: "b", mode: "interrupt" })));
    await waitFor(() => expect(box().value).toBe(""));
    fireEvent.change(box(), { target: { value: "c" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ text: "c", mode: "steer" })));
  });

  it("空闲：Enter=normal，变为“继续对话”，且不显示插话/排队/打断分段", async () => {
    const request = seedHub();
    useHub.setState((s) => ({ model: { ...s.model, tasks: { ...s.model.tasks, "task-fix-callback": { ...s.model.tasks["task-fix-callback"]!, status: "done" } } } }));
    renderAt();
    expect(screen.queryByRole("radio", { name: "排队" })).toBeNull();
    expect(screen.getByText(/任务已结束/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("继续和小码对话…"), { target: { value: "再改一下" } });
    fireEvent.keyDown(screen.getByPlaceholderText("继续和小码对话…"), { key: "Enter" });
    await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", { threadId: "thread-fix-callback", text: "再改一下", mode: "normal" }));
  });
});

describe("按钮与分支", () => {
  it("“从这里分支”调用 task.fork 并跳转到分支页", async () => {
    const request = seedHub();
    renderAt();
    const entry = document.querySelector('[data-entry-id="e-wb-5"]') as HTMLElement;
    fireEvent.click(within(entry).getByRole("button", { name: "从这里分支" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("task.fork", { taskId: "task-fix-callback", entryId: "e-wb-5" }));
    await waitFor(() => expect(screen.getByText("分支页")).toBeTruthy());
  });

  it("fork 失败时留在页面并提示", async () => {
    seedHub((m) => { if (m === "task.fork") throw new Error("busy"); });
    renderAt();
    fireEvent.click(screen.getAllByRole("button", { name: "从这里分支" })[0]!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("创建分支失败：busy"));
  });

  it("头部打断与菜单取消任务（需二次确认）", async () => {
    const request = seedHub();
    renderAt();
    fireEvent.click(screen.getByRole("button", { name: "打断任务" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("task.interrupt", { taskId: "task-fix-callback" }));
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "取消任务" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认取消" })); // 二次确认
    await waitFor(() => expect(request).toHaveBeenCalledWith("task.cancel", { taskId: "task-fix-callback" }));
  });

  it("菜单“查看分支”指向分支页", () => {
    seedHub();
    renderAt();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("menuitem", { name: "查看分支" }).getAttribute("href")).toBe("/task/task-fix-callback/branches");
  });
});
