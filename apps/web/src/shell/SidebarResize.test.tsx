import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { drag, ensurePointerEvent } from "../components/layout/testPointer";
import { SIDEBAR_WIDTH, useSidebar } from "./sidebarState";
import { mountShell, resetShellState, stubBrowser, teardownShell } from "./testUtils";

beforeAll(ensurePointerEvent);
beforeEach(() => {
  stubBrowser();
  resetShellState();
});
afterEach(() => {
  cleanup();
  teardownShell();
});

const handle = () => screen.getByRole("separator", { name: "调整侧栏宽度" });
const slot = () => handle().parentElement!;
const sidebar = () => screen.getByRole("complementary", { name: "侧栏" });

describe("侧栏拖动调宽", () => {
  it("默认 224px，范围 200-360，宽度经 --sidebar-w 作用到侧栏", () => {
    mountShell("/");
    expect(handle().getAttribute("aria-valuenow")).toBe("224");
    expect(handle().getAttribute("aria-valuemin")).toBe("200");
    expect(handle().getAttribute("aria-valuemax")).toBe("360");
    expect(slot().contains(sidebar())).toBe(true);
    expect(slot().style.getPropertyValue("--sidebar-w")).toBe("224px");
  });

  it("拖动右边缘调宽并持久化；拖动中关闭宽度过渡", () => {
    mountShell("/");
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientX: 224 });
    expect(slot().hasAttribute("data-resizing")).toBe(true);
    fireEvent.pointerUp(handle(), { pointerId: 1, clientX: 304 });
    expect(slot().hasAttribute("data-resizing")).toBe(false);
    expect(slot().style.getPropertyValue("--sidebar-w")).toBe("304px");
    expect(localStorage.getItem(SIDEBAR_WIDTH.storageKey)).toBe("304");

    drag(handle(), 400);
    expect(handle().getAttribute("aria-valuenow")).toBe("360");
  });

  it("读取已保存的宽度；键盘 ←/→ 调 16px；双击恢复 224", () => {
    localStorage.setItem(SIDEBAR_WIDTH.storageKey, "280");
    mountShell("/");
    expect(handle().getAttribute("aria-valuenow")).toBe("280");
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle().getAttribute("aria-valuenow")).toBe("264");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle().getAttribute("aria-valuenow")).toBe("296");
    expect(localStorage.getItem(SIDEBAR_WIDTH.storageKey)).toBe("296");
    fireEvent.doubleClick(handle());
    expect(handle().getAttribute("aria-valuenow")).toBe("224");
    expect(localStorage.getItem(SIDEBAR_WIDTH.storageKey)).toBeNull();
  });

  it("拖到很窄时松开吸附为 68px 图标栏，不改动保存的宽度", () => {
    mountShell("/");
    drag(handle(), -120);
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");
    expect(screen.queryByRole("separator", { name: "调整侧栏宽度" })).toBeNull();
    expect(localStorage.getItem(SIDEBAR_WIDTH.storageKey)).toBeNull();
    act(() => useSidebar.getState().toggle());
    expect(handle().getAttribute("aria-valuenow")).toBe("224");
  });

  it("拖到下限附近但未过吸附阈值时停在 200px", () => {
    mountShell("/");
    drag(handle(), -60);
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");
    expect(handle().getAttribute("aria-valuenow")).toBe("200");
  });

  it("移动端（抽屉导航）不提供拖动", () => {
    mountShell("/");
    act(() => useSidebar.setState({ mobile: true }));
    expect(screen.queryByRole("separator", { name: "调整侧栏宽度" })).toBeNull();
  });
});
