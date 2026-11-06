import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { bots, tasks, threads } from "@muster/protocol/fixtures";
import { useHub } from "../lib/hub";
import { buildCommands, filterCommands } from "./commands";
import { crumbsFor } from "./navigation";
import { mountShell, resetShellState, stubBrowser, teardownShell } from "./testUtils";
import { useCommandPalette } from "./CommandPalette";

beforeEach(() => {
  stubBrowser();
  resetShellState();
});
afterEach(() => {
  cleanup();
  teardownShell();
});

const loc = () => screen.getByTestId("loc").textContent;
const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));
const src = { bots: byId(bots), tasks: byId(tasks), threads: byId(threads) };
const cmds = buildCommands(src, { toggleSidebar: () => undefined, mod: "Ctrl" });

describe("命令构建与过滤（纯函数）", () => {
  it("包含页面、成员、任务与三个快捷动作", () => {
    const labels = (g: string) => cmds.filter((c) => c.group === g).map((c) => c.label);
    expect(labels("动作")).toEqual(expect.arrayContaining(["新建成员", "新建触发器", "打开设置 · 模型"]));
    expect(labels("页面")).toEqual(expect.arrayContaining(["主线", "团队", "事件", "设备", "技能", "设置", "需要你", "成本", "记忆"]));
    expect(labels("成员")).toEqual(expect.arrayContaining(["Pip", "小码", "阿克"]));
    expect(cmds.find((c) => c.label === "新建成员")?.to).toBe("/crew?new=1");
    expect(cmds.find((c) => c.label === "新建触发器")?.to).toBe("/events?new=1");
    expect(cmds.find((c) => c.label === "打开设置 · 模型")?.to).toBe("/settings?tab=models");
    expect(cmds.find((c) => c.id === "bot:bot-pip")?.to).toBe("/");
  });

  it("按词过滤：多词 AND、标签前缀优先、无命中为空", () => {
    expect(filterCommands(cmds, "新建").map((c) => c.label)).toEqual(expect.arrayContaining(["新建成员", "新建触发器"]));
    expect(filterCommands(cmds, "小码")[0]?.group).toBe("成员");
    expect(filterCommands(cmds, "settings model").map((c) => c.label)).toEqual(["打开设置 · 模型"]);
    expect(filterCommands(cmds, "zzzz-not-exist")).toEqual([]);
    expect(filterCommands(cmds, "").length).toBeGreaterThan(10);
  });
});

describe("面包屑", () => {
  it("页面标题、工作台“主线 › 任务名”、分支页三级", () => {
    const t = { "task-1": { title: "修支付回调 bug" } };
    expect(crumbsFor("/crew", t)).toEqual([{ label: "团队" }]);
    expect(crumbsFor("/", t)).toEqual([{ label: "主线" }]);
    expect(crumbsFor("/task/task-1", t)).toEqual([{ label: "主线", to: "/" }, { label: "修支付回调 bug" }]);
    expect(crumbsFor("/task/task-1/branches", t)).toEqual([{ label: "主线", to: "/" }, { label: "修支付回调 bug", to: "/task/task-1" }, { label: "分支" }]);
  });
});

describe("TopBar 与命令面板", () => {
  it("顶部条展示面包屑与连接状态", async () => {
    mountShell("/devices");
    const crumbs = within(screen.getByRole("navigation", { name: "面包屑" }));
    expect(crumbs.getByText("设备").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("img", { name: /连接状态/ })).toBeTruthy();
  });

  it("点击搜索框 / Ctrl+K 打开，输入后 Enter 跳转，Esc 关闭", async () => {
    mountShell("/");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "搜索命令" });
    fireEvent.change(input, { target: { value: "团队" } });
    await waitFor(() => expect(screen.getAllByRole("option")[0]?.textContent).toContain("团队"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(loc()).toBe("/crew");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("↑↓ 选择、点击成员 / 任务 / 动作跳转", async () => {
    mountShell("/");
    await waitFor(() => expect(Object.keys(useHub.getState().model.tasks).length).toBeGreaterThan(0));
    const open = () => act(() => useCommandPalette.getState().setOpen(true));

    open();
    let input = await screen.findByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.change(input, { target: { value: "写退款接口" } });
    const taskOpt = await screen.findByRole("option", { name: /写退款接口/ });
    fireEvent.click(taskOpt);
    expect(loc()).toBe("/task/task-refund-api");

    open();
    input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "新建成员" } });
    fireEvent.click(await screen.findByRole("option", { name: /新建成员/ }));
    expect(loc()).toBe("/crew?new=1");

    open();
    input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "设置 模型" } });
    fireEvent.click(await screen.findByRole("option", { name: /打开设置 · 模型/ }));
    expect(loc()).toBe("/settings?tab=models");

    open();
    input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "小码" } });
    fireEvent.click((await screen.findAllByRole("option", { name: /小码/ }))[0]!); // 成员分组排在任务之前
    expect(loc()).toMatch(/^\/task\//);
  });

  it("无结果时显示空态", async () => {
    mountShell();
    act(() => useCommandPalette.getState().setOpen(true));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "zzzzzz" } });
    expect(await screen.findByText(/没有找到/)).toBeTruthy();
  });

  it("“收起 / 展开侧栏”动作", async () => {
    mountShell();
    act(() => useCommandPalette.getState().setOpen(true));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "侧栏" } });
    fireEvent.click(await screen.findByRole("option", { name: /收起 \/ 展开侧栏/ }));
    expect(screen.getByRole("complementary", { name: "侧栏" }).getAttribute("data-collapsed")).toBe("true");
  });
});

describe("“需要你”铃铛", () => {
  it("角标显示待审批数，点开浮层可直接允许，处理后角标消失", async () => {
    mountShell();
    await waitFor(() => expect(screen.getByTestId("bell-badge").textContent).toBe("1"));
    const bell = screen.getByRole("button", { name: /需要你（1 项待处理）/ });
    fireEvent.click(bell);

    const pop = await screen.findByRole("dialog");
    expect(within(pop).getAllByText(/pnpm/).length).toBeGreaterThan(0);
    fireEvent.click(within(pop).getByRole("button", { name: "允许" }));

    await waitFor(() => expect(screen.queryByTestId("bell-badge")).toBeNull());
    expect(await within(screen.getByRole("dialog")).findByText("都处理完啦")).toBeTruthy();
  });

  it("可以直接拒绝；“全部查看”跳到收件箱", async () => {
    mountShell("/crew");
    await waitFor(() => expect(screen.getByTestId("bell-badge")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /需要你/ }));
    const pop = await screen.findByRole("dialog");
    fireEvent.click(within(pop).getByRole("link", { name: /全部查看/ }));
    expect(loc()).toBe("/inbox");

    fireEvent.click(screen.getByRole("button", { name: /需要你/ }));
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(screen.queryByTestId("bell-badge")).toBeNull());
  });
});
