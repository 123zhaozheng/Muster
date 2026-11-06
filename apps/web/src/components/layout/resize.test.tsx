import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatLayout, ListDetail } from "./index";
import { CONTEXT_PANEL_WIDTH, useContextPanelStore } from "./contextPanelState";
import { LIST_WIDTH_KEY } from "./ListDetail";
import { drag, ensurePointerEvent } from "./testPointer";

beforeAll(ensurePointerEvent);
beforeEach(() => {
  localStorage.clear();
  useContextPanelStore.setState({ pref: null, wide: true, drawerOpen: false });
});
afterEach(cleanup);

const listDetail = (props: Partial<Parameters<typeof ListDetail>[0]> = {}) => (
  <ListDetail list={<div>列表</div>} detail={<div>详情</div>} showDetail={false} onBack={() => undefined} {...props} />
);
const listHandle = () => screen.getByRole("separator", { name: "调整列表宽度" });
const listPane = () => listHandle().parentElement!;

describe("ResizeHandle · ListDetail 列表栏", () => {
  it("可聚焦的竖向分隔条，带当前值与范围；窄屏隐藏", () => {
    render(listDetail());
    const h = listHandle();
    expect(h.getAttribute("aria-orientation")).toBe("vertical");
    expect(h.tabIndex).toBe(0);
    expect(h.getAttribute("aria-valuenow")).toBe("340");
    expect(h.getAttribute("aria-valuemin")).toBe("240");
    expect(h.getAttribute("aria-valuemax")).toBe("480");
    expect(h.className).toContain("cursor-col-resize");
    expect(h.className).toContain("max-md:hidden");
    expect(listPane().style.getPropertyValue("--list-w")).toBe("340px");
  });

  it("拖动右边缘调宽，松开后持久化；超出范围被夹住", () => {
    render(listDetail());
    drag(listHandle(), 60);
    expect(listHandle().getAttribute("aria-valuenow")).toBe("400");
    expect(listPane().style.getPropertyValue("--list-w")).toBe("400px");
    expect(localStorage.getItem(LIST_WIDTH_KEY)).toBe("400");

    drag(listHandle(), 500);
    expect(listHandle().getAttribute("aria-valuenow")).toBe("480");
    drag(listHandle(), -1000);
    expect(listHandle().getAttribute("aria-valuenow")).toBe("240");
    expect(localStorage.getItem(LIST_WIDTH_KEY)).toBe("240");
  });

  it("拖动过程中按帧更新宽度，拖动中不写入存储", async () => {
    render(listDetail());
    const h = listHandle();
    fireEvent.pointerDown(h, { button: 0, pointerId: 1, clientX: 500 });
    expect(h.getAttribute("data-resizing")).toBe("true");
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerMove(h, { pointerId: 1, clientX: 532 });
    await waitFor(() => expect(h.getAttribute("aria-valuenow")).toBe("372"));
    expect(localStorage.getItem(LIST_WIDTH_KEY)).toBeNull();
    fireEvent.pointerUp(h, { pointerId: 1, clientX: 532 });
    expect(h.getAttribute("data-resizing")).toBeNull();
    expect(document.body.style.cursor).toBe("");
    expect(localStorage.getItem(LIST_WIDTH_KEY)).toBe("372");
  });

  it("pointercancel 恢复到拖动前的宽度且不持久化", () => {
    render(listDetail());
    drag(listHandle(), 80, "cancel");
    expect(listHandle().getAttribute("aria-valuenow")).toBe("340");
    expect(localStorage.getItem(LIST_WIDTH_KEY)).toBeNull();
  });

  it("←/→ 每次 16px，Home/End 到边界", () => {
    render(listDetail());
    const h = listHandle();
    fireEvent.keyDown(h, { key: "ArrowRight" });
    expect(h.getAttribute("aria-valuenow")).toBe("356");
    fireEvent.keyDown(h, { key: "ArrowLeft" });
    fireEvent.keyDown(h, { key: "ArrowLeft" });
    expect(h.getAttribute("aria-valuenow")).toBe("324");
    expect(localStorage.getItem(LIST_WIDTH_KEY)).toBe("324");
    fireEvent.keyDown(h, { key: "End" });
    expect(h.getAttribute("aria-valuenow")).toBe("480");
    fireEvent.keyDown(h, { key: "Home" });
    expect(h.getAttribute("aria-valuenow")).toBe("240");
  });

  it("双击恢复默认宽度并清除存储", () => {
    render(listDetail({ listWidth: 360 }));
    drag(listHandle(), -60);
    expect(localStorage.getItem(LIST_WIDTH_KEY)).toBe("300");
    fireEvent.doubleClick(listHandle());
    expect(listHandle().getAttribute("aria-valuenow")).toBe("360");
    expect(localStorage.getItem(LIST_WIDTH_KEY)).toBeNull();
  });

  it("读取已保存的宽度（越界值被夹住，可按页面区分键）", () => {
    localStorage.setItem(LIST_WIDTH_KEY, "300");
    localStorage.setItem("muster.devices.list", "9999");
    render(listDetail());
    expect(listHandle().getAttribute("aria-valuenow")).toBe("300");
    cleanup();
    render(listDetail({ storageKey: "muster.devices.list" }));
    expect(listHandle().getAttribute("aria-valuenow")).toBe("480");
  });
});

describe("ResizeHandle · ChatLayout 上下文面板", () => {
  beforeEach(() => useContextPanelStore.setState({ pref: "open" }));
  const layout = () => (
    <ChatLayout panel={<div>面板内容</div>} panelTitle="此刻">
      <div>消息</div>
    </ChatLayout>
  );
  const handle = () => screen.getByRole("separator", { name: "调整上下文面板宽度" });
  const panel = () => screen.getByRole("complementary", { name: "此刻" });

  it("默认 340px；向左拖动变宽，向右变窄（最窄 300），宽度持久化", () => {
    render(layout());
    expect(panel().style.width).toBe("340px");
    expect(handle().getAttribute("aria-valuemin")).toBe("300");
    expect(handle().getAttribute("aria-valuemax")).toBe("560");
    drag(handle(), -100);
    expect(panel().style.width).toBe("440px");
    expect(localStorage.getItem(CONTEXT_PANEL_WIDTH.storageKey)).toBe("440");
    drag(handle(), 400);
    expect(panel().style.width).toBe("300px");
  });

  it("键盘：→ 变窄 16px、← 变宽 16px；双击回到 340", () => {
    localStorage.setItem(CONTEXT_PANEL_WIDTH.storageKey, "420");
    render(layout());
    expect(panel().style.width).toBe("420px");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(panel().style.width).toBe("404px");
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(panel().style.width).toBe("436px");
    fireEvent.doubleClick(handle());
    expect(panel().style.width).toBe("340px");
    expect(localStorage.getItem(CONTEXT_PANEL_WIDTH.storageKey)).toBeNull();
  });

  it("窄屏抽屉不可拖动", async () => {
    useContextPanelStore.setState({ wide: false, drawerOpen: true });
    render(layout());
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("separator", { name: "调整上下文面板宽度" })).toBeNull();
  });
});
