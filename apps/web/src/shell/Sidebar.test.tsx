import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useHub } from "../lib/hub";
import { useSidebar, SIDEBAR_KEY, watchViewport } from "./sidebarState";
import { mountShell, resetShellState, stubBrowser, teardownShell } from "./testUtils";

beforeEach(() => {
  stubBrowser();
  resetShellState();
});
afterEach(() => {
  cleanup();
  teardownShell();
});

const aside = () => screen.getByRole("complementary", { name: "侧栏" });
const loc = () => screen.getByTestId("loc").textContent;

describe("Shell / Sidebar（mock 数据）", () => {
  it("导航分组、演示模式标签、需要你角标、最近对话、Pip 卡片", async () => {
    mountShell("/crew");
    await waitFor(() => expect(screen.getAllByLabelText("1 项待处理").length).toBeGreaterThan(0));

    const nav = screen.getByRole("navigation", { name: "主导航" });
    for (const label of ["主线", "团队", "事件", "设备", "技能", "设置", "需要你", "成本", "记忆"]) expect(within(nav).getByRole("link", { name: label })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "团队" }).getAttribute("href")).toBe("/crew");
    expect(within(nav).getByRole("link", { name: "需要你" }).getAttribute("href")).toBe("/inbox");
    expect(within(nav).getByRole("link", { name: "团队" }).getAttribute("aria-current")).toBe("page"); // 选中态
    expect(within(nav).getByRole("link", { name: "主线" }).getAttribute("aria-current")).toBeNull();

    expect(within(aside()).getByText("演示模式")).toBeTruthy();
    expect(screen.getByText("你好！我是 Pip")).toBeTruthy();

    const recent = within(screen.getByRole("region", { name: "最近对话" }));
    const links = recent.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/", "/task/task-fix-callback", "/task/task-refund-api"]));
    expect(recent.getByText("写退款接口")).toBeTruthy();
    expect(recent.getAllByRole("img").length).toBeGreaterThan(0); // 状态点
  });

  it("最近对话可折叠并记住", async () => {
    mountShell();
    await waitFor(() => expect(screen.getByText("写退款接口")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /最近对话/ }));
    expect(screen.queryByText("写退款接口")).toBeNull();
    expect(localStorage.getItem("muster.sidebar.recent")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: /最近对话/ }));
    expect(screen.getByText("写退款接口")).toBeTruthy();
  });

  it("空态：没有对话时给出友好提示", () => {
    mountShell();
    act(() => useHub.setState({ model: { ...useHub.getState().model, threads: {} } }));
    expect(screen.getByText(/还没有对话/)).toBeTruthy();
  });

  it("点击 Logo 回到主线 /", () => {
    mountShell("/crew");
    expect(loc()).toBe("/crew");
    fireEvent.click(screen.getByRole("link", { name: /Muster，回到主线/ }));
    expect(loc()).toBe("/");
  });
});

describe("侧栏收起 / 展开", () => {
  it("底部按钮切换、持久化到 localStorage、收起态保留图标并有 aria-label", () => {
    mountShell();
    expect(aside().getAttribute("data-collapsed")).toBe("false");
    expect(aside().className).toContain("w-[248px]");

    fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(aside().getAttribute("data-collapsed")).toBe("true");
    expect(aside().className).toContain("w-[72px]");
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("1");
    expect(screen.queryByText("你好！我是 Pip")).toBeNull();
    expect(within(aside()).getByRole("link", { name: "团队" }).getAttribute("href")).toBe("/crew"); // 仍可点击
    // 回归：收起态 NavLink 被 Tooltip(Slot) 包裹时 className 不能被字符串化丢失
    const teamCls = within(aside()).getByRole("link", { name: "团队" }).className;
    expect(teamCls).toContain("h-10");
    expect(teamCls).toContain("justify-center");
    expect(teamCls).not.toContain("=>");
    expect(within(aside()).getByRole("link", { name: /Muster，回到主线/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(aside().getAttribute("data-collapsed")).toBe("false");
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("0");
  });

  it("读取已持久化的收起状态", () => {
    localStorage.setItem(SIDEBAR_KEY, "1");
    // 模拟新会话：store 在模块加载时读取，这里用等价的 setState 路径验证渲染
    useSidebar.setState({ pref: localStorage.getItem(SIDEBAR_KEY) === "1" });
    mountShell();
    expect(aside().getAttribute("data-collapsed")).toBe("true");
  });

  it("Ctrl+B 与 ⌘+B 切换", () => {
    mountShell();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(aside().getAttribute("data-collapsed")).toBe("true");
    fireEvent.keyDown(window, { key: "B", metaKey: true });
    expect(aside().getAttribute("data-collapsed")).toBe("false");
    fireEvent.keyDown(window, { key: "b" }); // 没有修饰键：不响应
    expect(aside().getAttribute("data-collapsed")).toBe("false");
  });

  it("窄于 1200px 自动收起；变宽后回到用户偏好；窄屏下手动展开不写入偏好", () => {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    }));
    try {
      mountShell();
      const off = watchViewport();
      expect(aside().getAttribute("data-collapsed")).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
      expect(aside().getAttribute("data-collapsed")).toBe("false");
      expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull();

      matches = false;
      act(() => listeners.forEach((f) => f()));
      expect(aside().getAttribute("data-collapsed")).toBe("false");
      matches = true;
      act(() => listeners.forEach((f) => f()));
      expect(aside().getAttribute("data-collapsed")).toBe("true"); // override 已在跨阈值时清除
      off();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("连接横幅", () => {
  it("连接中 / 已断开出现并带重试按钮，open 后消失", async () => {
    mountShell();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull()); // mock 立即 open
    act(() => useHub.setState({ status: "closed" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("连接已断开"));
    expect(within(screen.getByRole("status")).getByRole("button", { name: "立即重试" })).toBeTruthy();
    act(() => useHub.setState({ status: "connecting" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/正在(重新)?连接/));
  });

  it("重试优先调用传输层的 reconnect()", async () => {
    mountShell();
    await waitFor(() => expect(useHub.getState().status).toBe("open")); // mock 在微任务里报告 open
    const reconnect = vi.fn();
    act(() => useHub.setState({ status: "closed", client: { ...useHub.getState().client!, reconnect } as never }));
    fireEvent.click(await screen.findByRole("button", { name: "立即重试" }));
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /重试中/ })).toBeTruthy();
  });
});
