import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setReduceMotion } from "@muster/ui";
import { useHub } from "../lib/hub";
import { SIDEBAR_KEY, useSidebar, watchViewport } from "./sidebarState";
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

describe("Sidebar（mock 数据）", () => {
  it("两组导航、个人分组、需要你角标、当前项、设置与连接状态", async () => {
    mountShell("/crew");
    await waitFor(() => expect(screen.getAllByLabelText("1 项待处理").length).toBeGreaterThan(0));

    const nav = within(screen.getByRole("navigation", { name: "主导航" }));
    for (const label of ["主线", "团队", "事件", "资源库", "设备", "需要你", "记忆", "技能", "成本"]) expect(nav.getByRole("link", { name: label })).toBeTruthy();
    expect(nav.getByText("个人")).toBeTruthy();
    expect(nav.getByRole("link", { name: "资源库" }).getAttribute("href")).toBe("/library");
    expect(nav.getByRole("link", { name: "需要你" }).getAttribute("href")).toBe("/inbox");
    expect(nav.getByRole("link", { name: "团队" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("link", { name: "主线" }).getAttribute("aria-current")).toBeNull();

    expect(within(aside()).getByRole("link", { name: "设置" }).getAttribute("href")).toBe("/settings");
    expect(within(aside()).getByRole("status").textContent).toContain("Pip 已连接");
    expect(within(aside()).getByText("演示")).toBeTruthy();
  });

  it("连接断开时显示重试", async () => {
    mountShell();
    await waitFor(() => expect(useHub.getState().status).toBe("open"));
    act(() => useHub.setState({ status: "closed" }));
    const status = within(aside()).getByRole("status");
    expect(status.textContent).toContain("已断开");
    expect(within(status).getByRole("button", { name: /重试/ })).toBeTruthy();
  });

  it("最近对话默认 4 条，可展开更多并记住", async () => {
    mountShell();
    await waitFor(() => expect(useHub.getState().model.threads["thread-main"]).toBeTruthy());
    const base = useHub.getState().model.threads["thread-main"]!;
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`t${i}`, { ...base, id: `t${i}`, title: `对话 ${i}`, taskId: `task-${i}`, updatedAt: `2026-11-0${i + 1}T00:00:00Z` }]));
    act(() => useHub.setState({ model: { ...useHub.getState().model, threads: many } }));
    const recent = () => within(screen.getByRole("region", { name: "最近对话" }));
    expect(recent().getAllByRole("link")).toHaveLength(4);
    fireEvent.click(recent().getByRole("button", { name: "展开更多最近对话" }));
    expect(recent().getAllByRole("link")).toHaveLength(7);
    expect(localStorage.getItem("muster.sidebar.recent")).toBe("1");
    fireEvent.click(recent().getByRole("button", { name: "收起最近对话" }));
    expect(recent().getAllByRole("link")).toHaveLength(4);
  });

  it("空态：没有对话时给出提示", () => {
    mountShell();
    act(() => useHub.setState({ model: { ...useHub.getState().model, threads: {} } }));
    expect(screen.getByText(/还没有对话/)).toBeTruthy();
  });

  it("点击品牌回到主线 /，搜索按钮打开全局搜索", () => {
    mountShell("/crew");
    fireEvent.click(screen.getByRole("link", { name: /Muster，回到主线/ }));
    expect(loc()).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("导航图标、品牌头像与连接点带微动效；减少动态效果时全部去掉", async () => {
    mountShell("/crew");
    await waitFor(() => expect(useHub.getState().model.threads["thread-main"]).toBeTruthy());
    const navIcon = () => within(screen.getByRole("navigation", { name: "主导航" })).getByRole("link", { name: "团队" }).querySelector(".muster-icon");
    expect(navIcon()).not.toBeNull();
    expect(within(aside()).getByRole("link", { name: /Muster，回到主线/ }).querySelector(".muster-wiggle .pebble-live")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "最近对话" })).getAllByRole("link")[0]!.querySelector(".muster-icon")).not.toBeNull();
    act(() => useHub.setState({ status: "connecting" }));
    expect(within(aside()).getByRole("status").querySelector(".muster-ping")).not.toBeNull();

    act(() => setReduceMotion(true));
    try {
      expect(navIcon()).toBeNull();
      expect(aside().querySelector(".muster-icon, .muster-wiggle, .muster-ping, .pebble-live")).toBeNull();
    } finally {
      act(() => setReduceMotion(false));
    }
  });
});

describe("侧栏收起 / 展开", () => {
  it("按钮切换并持久化；收起后保留图标链接与 aria-label", () => {
    mountShell();
    expect(aside().getAttribute("data-collapsed")).toBe("false");
    expect(aside().className).toContain("w-[224px]");

    fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(aside().getAttribute("data-collapsed")).toBe("true");
    expect(aside().className).toContain("w-[68px]");
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("1");
    expect(within(aside()).getByRole("link", { name: "团队" }).getAttribute("href")).toBe("/crew");
    expect(within(aside()).getByRole("link", { name: /Muster，回到主线/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(aside().getAttribute("data-collapsed")).toBe("false");
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("0");
  });

  it("Ctrl+B 与 ⌘+B 切换；没有修饰键不响应", () => {
    mountShell();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(aside().getAttribute("data-collapsed")).toBe("true");
    fireEvent.keyDown(window, { key: "B", metaKey: true });
    expect(aside().getAttribute("data-collapsed")).toBe("false");
    fireEvent.keyDown(window, { key: "b" });
    expect(aside().getAttribute("data-collapsed")).toBe("false");
  });

  it("窄于 1100px 自动收起，变宽后回到偏好；窄屏手动展开不写入偏好", () => {
    const state = { narrow: true, mobile: false };
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (q: string) => ({
      get matches() {
        return q.includes("1099") ? state.narrow : state.mobile;
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

      state.narrow = false;
      act(() => listeners.forEach((f) => f()));
      expect(aside().getAttribute("data-collapsed")).toBe("false");
      state.narrow = true;
      act(() => listeners.forEach((f) => f()));
      expect(aside().getAttribute("data-collapsed")).toBe("true");
      off();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("窄于 768px 导航进入抽屉，菜单按钮打开，跳转后关闭", async () => {
    mountShell("/");
    act(() => useSidebar.getState().setViewport({ narrow: true, mobile: true }));
    expect(screen.queryByRole("complementary", { name: "侧栏" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("link", { name: "团队" }));
    expect(loc()).toBe("/crew");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("连接横幅", () => {
  it("连接中 / 已断开出现并带重试按钮，open 后消失", async () => {
    mountShell();
    await waitFor(() => expect(screen.queryByText(/正在(重新)?连接守护进程|连接已断开/)).toBeNull());
    act(() => useHub.setState({ status: "closed" }));
    await waitFor(() => expect(screen.getByText(/连接已断开/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "立即重试" })).toBeTruthy();
    act(() => useHub.setState({ status: "connecting" }));
    await waitFor(() => expect(screen.getByText(/正在(重新)?连接/)).toBeTruthy());
  });

  it("重试优先调用传输层的 reconnect()", async () => {
    mountShell();
    await waitFor(() => expect(useHub.getState().status).toBe("open"));
    const reconnect = vi.fn();
    act(() => useHub.setState({ status: "closed", client: { ...useHub.getState().client!, reconnect } as never }));
    fireEvent.click(await screen.findByRole("button", { name: "立即重试" }));
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /重试中/ })).toBeTruthy();
  });
});
