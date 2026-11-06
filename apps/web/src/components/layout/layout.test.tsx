import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ChatHeader, ChatLayout, ContextPanelToggle, ListDetail, Page, PageBody, statusPillText } from "./index";
import { CONTEXT_PANEL_KEY, useContextPanelStore } from "./contextPanelState";

beforeEach(() => {
  localStorage.clear();
  useContextPanelStore.setState({ pref: null, wide: true, drawerOpen: false });
});
afterEach(cleanup);

describe("Page 原语", () => {
  it("Page：管理页最大宽 1200 居中；fill 去掉宽度限制", () => {
    const { rerender } = render(<Page data-testid="p">内容</Page>);
    expect(screen.getByTestId("p").className).toContain("max-w-[1200px]");
    expect(screen.getByTestId("p").className).toContain("mx-auto");
    rerender(<Page fill data-testid="p">内容</Page>);
    expect(screen.getByTestId("p").className).not.toContain("max-w-[1200px]");
  });

  it("PageBody：有右栏才渲染 aside，宽度限制在 280-360", () => {
    const { container, rerender } = render(<PageBody main={<div>主区</div>} rail={<div>右栏</div>} railWidth={999} />);
    expect(container.querySelector("aside")?.textContent).toBe("右栏");
    expect(container.querySelector<HTMLElement>(".grid")!.style.getPropertyValue("--muster-rail")).toBe("360px");
    rerender(<PageBody main={<div>主区</div>} />);
    expect(container.querySelector("aside")).toBeNull();
  });
});

describe("ChatLayout", () => {
  const layout = () => (
    <ChatLayout header={<ContextPanelToggle />} footer={<div>输入区</div>} panel={<div>面板内容</div>} panelTitle="此刻">
      <div>消息</div>
    </ChatLayout>
  );

  it("宽屏：右栏默认关闭；打开后内联显示，可收起，状态持久化", () => {
    render(layout());
    expect(screen.getByText("消息")).toBeTruthy();
    expect(screen.getByText("输入区")).toBeTruthy();
    expect(screen.queryByText("面板内容")).toBeNull();
    expect(screen.getByRole("button", { name: "打开上下文" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "打开上下文" }));
    expect(screen.getByText("面板内容")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "此刻" })).toBeTruthy();
    expect(localStorage.getItem(CONTEXT_PANEL_KEY)).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "收起上下文" }));
    expect(screen.queryByText("面板内容")).toBeNull();
    expect(localStorage.getItem(CONTEXT_PANEL_KEY)).toBe("closed");
  });

  it("读取已持久化的打开状态", () => {
    useContextPanelStore.setState({ pref: "open" });
    render(layout());
    expect(screen.getByText("面板内容")).toBeTruthy();
  });

  it("窄于 1440px：默认收起，用抽屉打开，不写入偏好", async () => {
    useContextPanelStore.setState({ wide: false });
    render(layout());
    expect(screen.queryByText("面板内容")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开上下文" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("面板内容")).toBeTruthy();
    expect(localStorage.getItem(CONTEXT_PANEL_KEY)).toBeNull();
    act(() => useContextPanelStore.getState().setOpen(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("没有 panel 的页面不渲染右栏", () => {
    render(<ChatLayout>仅对话</ChatLayout>);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("ChatHeader", () => {
  const header = (props: Partial<Parameters<typeof ChatHeader>[0]> = {}) => (
    <MemoryRouter>
      <ChatLayout header={<ChatHeader title="Pip" panelToggle {...props} />} panel={<div>面板内容</div>} panelTitle="此刻">
        <div>消息</div>
      </ChatLayout>
    </MemoryRouter>
  );

  it("状态胶囊文字：只写非零部分，全为零时为空", () => {
    expect(statusPillText({ needsYou: 2, active: 3 })).toBe("2 需要你 · 3 进行中");
    expect(statusPillText({ needsYou: 0, active: 3 })).toBe("3 进行中");
    expect(statusPillText({ needsYou: 1, active: 0 })).toBe("1 需要你");
    expect(statusPillText({ needsYou: 0, active: 0 })).toBeNull();
  });

  it("左侧只有会话名（无数据时没有 ⌄），没有大标题；点状态胶囊打开右栏", () => {
    render(header({ status: { needsYou: 2, active: 3 } }));
    expect(screen.getByRole("heading", { level: 1, name: "Pip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "更多" })).toBeNull();
    expect(screen.queryByText("面板内容")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 需要你 · 3 进行中" }));
    expect(screen.getByText("面板内容")).toBeTruthy();
  });

  it("计数全为零时不显示状态胶囊", () => {
    render(header({ status: { needsYou: 0, active: 0 } }));
    expect(screen.queryByText(/需要你|进行中/)).toBeNull();
  });

  it("有最近对话时 ⌄ 打开菜单，列出真实对话链接", async () => {
    render(header({ conversations: [{ id: "t1", label: "小码 · 修登录", to: "/task/t1" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Pip" }));
    const menu = await screen.findByRole("dialog", { name: "最近的对话" });
    expect(within(menu).getByRole("link", { name: "小码 · 修登录" }).getAttribute("href")).toBe("/task/t1");
  });

  it("面包屑模式：主线 / 小码 · 标题", () => {
    render(header({ trail: [{ label: "主线", to: "/" }], title: "小码 · 修登录" }));
    expect(screen.getByRole("link", { name: "主线" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("heading", { level: 1, name: "小码 · 修登录" })).toBeTruthy();
  });

  it("⋯ 菜单只在有条目时出现", async () => {
    let picked = 0;
    render(header({ menu: [{ id: "x", label: "重命名", onSelect: () => picked++ }] }));
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "重命名" }));
    expect(picked).toBe(1);
  });
});

describe("ListDetail", () => {
  it("窄屏只显示列表或详情之一，详情里有返回", () => {
    let back = 0;
    const { rerender } = render(<ListDetail list={<div>列表</div>} detail={<div>详情</div>} showDetail={false} onBack={() => back++} />);
    const listPane = () => screen.getByText("列表").parentElement!.parentElement!;
    expect(listPane().className).not.toContain("max-md:hidden");
    expect(screen.getByText("详情").parentElement!.className).toContain("max-md:hidden");

    rerender(<ListDetail list={<div>列表</div>} detail={<div>详情</div>} showDetail onBack={() => back++} />);
    expect(listPane().className).toContain("max-md:hidden");
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    expect(back).toBe(1);
  });
});
