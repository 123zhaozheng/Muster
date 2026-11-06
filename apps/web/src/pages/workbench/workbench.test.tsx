import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useHub } from "../../lib/hub";
import { setSendKey } from "../../lib/preferences";
import { seedHub } from "../../components/workbench/testHarness";
import { drag, ensurePointerEvent } from "../../components/layout/testPointer";
import Workbench from "./index";

function renderAt(path = "/task/task-fix-callback") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>主线页</div>} />
        <Route path="/task/:taskId" element={<Workbench />} />
      </Routes>
    </MemoryRouter>,
  );
}

const box = () => screen.getByPlaceholderText("给小码插话…") as HTMLTextAreaElement;
function type(text: string, key: Record<string, unknown> = { key: "Enter" }) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), key);
}

// Radix 的标签在 mousedown 时切换。
const openTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

beforeEach(() => cleanup());

describe("工单详情渲染 thread-fix-callback", () => {
  beforeEach(() => void seedHub());

  it("头部 44px 一行：面包屑“主线 / 成员 · 标题”、状态、图标操作；没有分支页入口", () => {
    renderAt();
    const header = screen.getByRole("banner");
    expect(header.className).toContain("h-11");
    expect(within(screen.getByRole("navigation", { name: "面包屑" })).getByRole("link", { name: "主线" }).getAttribute("href")).toBe("/");
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.textContent).toBe("小码 · 修支付回调 bug");
    expect(within(header).getByText("执行中")).toBeTruthy();
    expect(within(header).getByRole("button", { name: "打断工单" }).textContent).toBe("");
    expect(within(header).getByRole("button", { name: "取消工单" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "查看分支" })).toBeNull();
  });

  it("运行中显示“小码正在工作…”提示", () => {
    renderAt();
    expect(screen.getByTestId("typing-indicator").textContent).toContain("小码正在");
  });

  it("对话：成员文本、折叠工具行、插话状态、测试结果、改动文件", () => {
    renderAt();
    expect(screen.getByText(/我来修复支付回调的兼容性问题/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /共 8 次调用/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /共 6 次调用/ })).toBeTruthy();
    expect(screen.getByTestId("steer-label").textContent).toBe("已采纳");
    expect(screen.getByText("回调要兼容旧签名")).toBeTruthy();
    expect(screen.getByTestId("test-result").textContent).toContain("12 通过 · 0 失败");
    // 有改动时右侧默认打开“改动”：统一 diff
    expect(screen.getByTestId("diff-view").querySelectorAll("[data-line=add]").length).toBe(3);
    expect(screen.getByTestId("diff-view").querySelectorAll("[data-line=del]").length).toBe(3);
  });

  it("点击工具行展开 items；终端标签汇总命令；日志标签显示该任务事件", () => {
    renderAt();
    const row = screen.getByRole("button", { name: /共 8 次调用/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(within(row.closest("[data-testid=tool-calls]") as HTMLElement).getAllByText(/pnpm test/).length).toBeGreaterThan(0);

    openTab(/终端/);
    expect(within(screen.getByTestId("terminal")).getByText("pnpm test")).toBeTruthy();

    openTab(/日志/);
    expect(screen.getByText("回调 · 小码 完成了 修支付回调")).toBeTruthy();
    expect(screen.getByText("工单开始")).toBeTruthy();
  });

  it("左侧步骤：只列真实里程碑，默认收起显示最新一步，展开后点一条回到对话", () => {
    renderAt();
    const steps = screen.getByRole("region", { name: "步骤" });
    const toggle = within(steps).getByRole("button", { name: /步骤 3/ });
    expect(toggle.textContent).toContain("最新：测试全部通过 · 12 通过 · 0 失败");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    const items = within(steps).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("已采纳：回调要兼容旧签名");
    expect(items[1]).toContain("修改了 1 个文件");
    expect(items[2]).toContain("测试全部通过 · 12 通过 · 0 失败");
    const target = document.querySelector('[data-entry-id="e-wb-6"]') as HTMLElement;
    const scrolled = vi.fn();
    target.scrollIntoView = scrolled;
    fireEvent.click(within(steps).getByRole("button", { name: /修改了 1 个文件/ }));
    expect(scrolled).toHaveBeenCalled();
  });

  it("没有里程碑的任务不显示步骤", () => {
    renderAt("/task/task-refund-api");
    expect(screen.queryByRole("region", { name: "步骤" })).toBeNull();
  });

  it("概况标签：紧凑的信息行；不显示估算的进度百分比", () => {
    renderAt();
    openTab(/概况/);
    const panel = screen.getByRole("tabpanel");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d+%/);
    expect(within(panel).getByText("muster/fix-callback")).toBeTruthy();
    expect(within(panel).getByText("D:/work/shop-api")).toBeTruthy();
    expect(within(panel).getByText("默认模型")).toBeTruthy();
    expect(within(panel).getByText("84.2K")).toBeTruthy();
    expect(within(panel).getByText("$0.41")).toBeTruthy();
    expect(within(panel).queryByRole("heading")).toBeNull();
  });

  it("没有尝试、改动和命令的工单只有“概况”和“日志”标签", () => {
    renderAt("/task/task-refund-api");
    expect(screen.getByRole("tab", { name: /概况/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /日志/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /改动/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /终端/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /方案/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /概况/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("改动标签：文件树选择文件", () => {
    renderAt();
    const tree = screen.getByRole("tree", { name: "改动文件" });
    expect(within(tree).getByText("callback.ts")).toBeTruthy();
    expect(within(tree).getByText("payment")).toBeTruthy();
  });

  it("点击 diff 卡片的文件会在右侧打开改动", () => {
    renderAt();
    openTab(/日志/);
    const card = document.querySelector('[data-entry-id="e-wb-6"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /callback.ts/ }));
    expect(screen.getByTestId("diff-view")).toBeTruthy();
  });

  it("头栏按钮收起 / 打开右侧面板", () => {
    renderAt();
    const toggle = screen.getByRole("button", { name: "产物与记录" });
    expect(screen.getByRole("complementary", { name: "产物与记录" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary", { name: "产物与记录" })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("complementary", { name: "产物与记录" })).toBeTruthy();
  });

  it("右侧面板可拖动左边缘调宽（260-560，默认 420），键盘可调，双击复位，宽度持久化", () => {
    ensurePointerEvent();
    localStorage.removeItem("muster.taskPanel.width");
    renderAt();
    const aside = () => screen.getByRole("complementary", { name: "产物与记录" });
    const handle = () => screen.getByRole("separator", { name: "调整产物面板宽度" });
    expect(aside().style.width).toBe("420px");
    expect(handle().getAttribute("aria-valuemin")).toBe("260");
    expect(handle().getAttribute("aria-valuemax")).toBe("560");
    drag(handle(), -80);
    expect(aside().style.width).toBe("500px");
    expect(localStorage.getItem("muster.taskPanel.width")).toBe("500");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(aside().style.width).toBe("484px");
    fireEvent.doubleClick(handle());
    expect(aside().style.width).toBe("420px");
    expect(localStorage.getItem("muster.taskPanel.width")).toBeNull();
  });

  it("思考：默认折叠为“已思考 Xs”，点开以左侧细线展示全文；不提供“从这里分支”", () => {
    const task = useHub.getState().model.tasks["task-fix-callback"]!;
    useHub.setState((s) => ({
      model: {
        ...s.model,
        entries: {
          ...s.model.entries,
          [task.threadId]: [...(s.model.entries[task.threadId] ?? []), { id: "e-th", threadId: task.threadId, ts: new Date().toISOString(), kind: "thinking", botId: task.botId, text: "旧签名走另一条验签分支", durationMs: 12_000 }],
        },
      },
    }));
    renderAt();
    const row = document.querySelector('[data-entry-id="e-th"]')!;
    const toggle = within(row as HTMLElement).getByRole("button", { name: /已思考 12s/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(row as HTMLElement).queryByRole("button", { name: "从这里分支" })).toBeNull();
    expect(screen.queryByText("旧签名走另一条验签分支")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("旧签名走另一条验签分支").className).toContain("border-l-2");
  });

  it("思考流式中：显示“思考中”，不再叠加“正在工作”提示", () => {
    const task = useHub.getState().model.tasks["task-fix-callback"]!;
    useHub.setState((s) => ({
      model: {
        ...s.model,
        entries: {
          ...s.model.entries,
          [task.threadId]: [...(s.model.entries[task.threadId] ?? []), { id: "e-th", threadId: task.threadId, ts: new Date().toISOString(), kind: "thinking", botId: task.botId, text: "先看", streaming: true }],
        },
      },
    }));
    renderAt();
    expect(screen.getByRole("button", { name: /思考中/ })).toBeTruthy();
    expect(screen.queryByTestId("typing-indicator")).toBeNull();
  });

  it("未知工单显示兜底", () => {
    renderAt("/task/nope");
    expect(screen.getByText("未找到这个工单")).toBeTruthy();
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

  it("输入法组字时 Enter 不发送（isComposing 或 keyCode 229）", async () => {
    const request = seedHub();
    renderAt();
    type("先看", { key: "Enter", isComposing: true });
    type("先看", { key: "Enter", keyCode: 229 });
    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    expect(box().value).toBe("先看");
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", { threadId: "thread-fix-callback", text: "先看", mode: "steer" }));
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

  it("快捷键提示按平台显示", () => {
    seedHub();
    const platform = vi.spyOn(navigator, "platform", "get");
    platform.mockReturnValue("MacIntel");
    renderAt();
    expect(screen.getByText("⌘")).toBeTruthy();
    expect(screen.getByText("⌥")).toBeTruthy();
    cleanup();
    platform.mockReturnValue("Win32");
    renderAt();
    expect(screen.getByText("Ctrl")).toBeTruthy();
    expect(screen.getByText("Alt")).toBeTruthy();
    platform.mockRestore();
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

describe("发送方式设为 Ctrl+Enter", () => {
  beforeEach(() => setSendKey("ctrl-enter"));
  afterEach(() => setSendKey("enter"));

  it("运行中：Enter 换行；Ctrl/⌘+Enter 按所选方式发送；Alt+Enter 排队；组字中不发送", async () => {
    const request = seedHub();
    renderAt();
    type("先看旧签名", { key: "Enter" });
    type("先看旧签名", { key: "Enter", ctrlKey: true, isComposing: true });
    type("先看旧签名", { key: "Enter", ctrlKey: true, keyCode: 229 });
    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    const cases: [Record<string, unknown>, string][] = [
      [{ key: "Enter", ctrlKey: true }, "steer"],
      [{ key: "Enter", metaKey: true }, "steer"],
      [{ key: "Enter", altKey: true }, "queue"],
    ];
    for (const [key, mode] of cases) {
      request.mockClear();
      type("先看旧签名", key);
      await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", { threadId: "thread-fix-callback", text: "先看旧签名", mode }));
      await waitFor(() => expect(box().value).toBe(""));
    }
    fireEvent.change(box(), { target: { value: "停下" } });
    fireEvent.click(screen.getByRole("radio", { name: "打断" }));
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", { threadId: "thread-fix-callback", text: "停下", mode: "interrupt" }));
  });

  it("空闲：Enter 不发送，Ctrl+Enter 发送 normal；提示不再写 Shift+Enter", async () => {
    const request = seedHub();
    useHub.setState((s) => ({ model: { ...s.model, tasks: { ...s.model.tasks, "task-fix-callback": { ...s.model.tasks["task-fix-callback"]!, status: "done" } } } }));
    renderAt();
    expect(screen.queryByText("Shift")).toBeNull();
    const idle = screen.getByPlaceholderText("继续和小码对话…");
    fireEvent.change(idle, { target: { value: "再改一下" } });
    fireEvent.keyDown(idle, { key: "Enter" });
    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    fireEvent.keyDown(idle, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(request).toHaveBeenCalledWith("chat.send", { threadId: "thread-fix-callback", text: "再改一下", mode: "normal" }));
  });
});

describe("按钮与方案", () => {
  const rows = () => within(screen.getByRole("list", { name: "尝试" })).getAllByTestId("attempt-row");

  it("“从这里分支”调用 task.fork，留在本页并打开“方案”标签", async () => {
    const request = seedHub();
    renderAt();
    const entry = document.querySelector('[data-entry-id="e-wb-5"]') as HTMLElement;
    fireEvent.click(within(entry).getByRole("button", { name: "从这里分支" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("task.fork", { taskId: "task-fix-callback", entryId: "e-wb-5" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /方案/ }).getAttribute("aria-selected")).toBe("true"));
    expect(rows()).toHaveLength(2);
  });

  it("fork 失败时留在页面并提示", async () => {
    seedHub((m) => { if (m === "task.fork") throw new Error("busy"); });
    renderAt();
    fireEvent.click(screen.getAllByRole("button", { name: "从这里分支" })[0]!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("创建分支失败：busy"));
  });

  it("方案标签：每个尝试一行（成员、状态、文件数、测试），标出当前，其它尝试可跳转", async () => {
    const request = seedHub();
    renderAt();
    expect(request).toHaveBeenCalledWith("task.branches", { taskId: "task-fix-callback" });
    await screen.findByRole("tab", { name: /方案\s*2/ });
    openTab(/方案/);
    const [a, b] = rows() as [HTMLElement, HTMLElement];
    expect(within(a).getByText("分支 A：队列重试")).toBeTruthy();
    expect(within(a).getByText("当前")).toBeTruthy();
    expect(within(a).getByText("3 个文件")).toBeTruthy();
    expect(within(a).getByText("12 通过")).toBeTruthy();
    expect(within(a).getByText("12.4K")).toBeTruthy();
    expect(within(a).getByText("执行中")).toBeTruthy();
    expect(within(b).getByText("2 个失败")).toBeTruthy();
    expect(within(b).getByRole("link", { name: "分支 B：幂等键方案" }).getAttribute("href")).toBe("/task/task-fix-callback-b");
  });

  it("从尝试的工单进入时同样以根工单的方案为准", async () => {
    const request = seedHub();
    renderAt("/task/task-fix-callback-b?panel=plans");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(request).toHaveBeenCalledWith("task.branches", { taskId: "task-fix-callback" });
    expect(within(rows()[1]!).getByText("当前")).toBeTruthy();
  });

  it("“采用”调用 branch.adopt 并标记已采用（目前只标记，不合并代码）", async () => {
    const request = seedHub();
    renderAt("/task/task-fix-callback?panel=plans");
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(within(rows()[0]!).getByRole("button", { name: "采用" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("branch.adopt", { branchId: "br-a" }));
    await waitFor(() => expect(within(rows()[0]!).getByRole("button", { name: "已采用" })).toBeTruthy());
    expect(within(rows()[1]!).getByRole("button", { name: "采用" })).toBeTruthy();
  });

  it("“从这一步重来”在该尝试的起点再开一个尝试；失败时提示", async () => {
    let forks = 0;
    const request = seedHub((m) => { if (m === "task.fork" && ++forks > 1) throw new Error("busy"); });
    renderAt("/task/task-fix-callback?panel=plans");
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(within(rows()[1]!).getByRole("button", { name: "从这一步重来" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("task.fork", { taskId: "task-fix-callback", entryId: "e-wb-5" }));
    fireEvent.click(within(rows()[1]!).getByRole("button", { name: "从这一步重来" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("重来失败：busy"));
  });

  it("对话里“从这里分出了 N 个分支”打开本页的方案标签", async () => {
    seedHub();
    renderAt();
    const link = await screen.findByRole("link", { name: /从这里分出了 2 个分支/ });
    expect(link.getAttribute("href")).toBe("/task/task-fix-callback?panel=plans");
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByRole("tab", { name: /方案/ }).getAttribute("aria-selected")).toBe("true"));
  });

  it("头部打断，取消工单需二次确认", async () => {
    const request = seedHub();
    renderAt();
    fireEvent.click(screen.getByRole("button", { name: "打断工单" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("task.interrupt", { taskId: "task-fix-callback" }));
    fireEvent.click(screen.getByRole("button", { name: "取消工单" }));
    expect(request).not.toHaveBeenCalledWith("task.cancel", expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "确认取消" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("task.cancel", { taskId: "task-fix-callback" }));
  });

  it("已完成的工单没有打断 / 取消", () => {
    seedHub();
    useHub.setState((s) => ({ model: { ...s.model, tasks: { ...s.model.tasks, "task-fix-callback": { ...s.model.tasks["task-fix-callback"]!, status: "done" } } } }));
    renderAt();
    expect(screen.queryByRole("button", { name: "打断工单" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消工单" })).toBeNull();
  });
});
