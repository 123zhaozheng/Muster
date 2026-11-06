import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { bots, tasks, threads } from "@muster/protocol/fixtures";
import type { Entry } from "@muster/protocol";
import { useHub } from "../lib/hub";
import { useCommandSearch } from "./CommandSearch";
import { searchAll } from "./search";
import { mountShell, resetShellState, stubBrowser, teardownShell } from "./testUtils";

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
const entries: Record<string, Entry[]> = {
  "thread-main": [
    { id: "e1", threadId: "thread-main", ts: "2026-11-06T09:00:00Z", kind: "user", text: "帮我查一下退款流程" },
    { id: "e2", threadId: "thread-main", ts: "2026-11-06T09:01:00Z", kind: "bot", botId: "bot-pip", text: "好的，我先让小探调研退款流程。" },
  ],
};
const src = { bots: byId(bots), tasks: byId(tasks), threads: byId(threads), entries };

describe("searchAll（纯函数）", () => {
  it("空查询：页面、成员与最近工单，不含对话", () => {
    const r = searchAll(src, "");
    const groups = new Set(r.map((x) => x.group));
    expect(groups).toEqual(new Set(["页面", "成员", "工单"]));
    expect(r.filter((x) => x.group === "页面").map((x) => x.label)).toEqual(expect.arrayContaining(["主线", "团队", "事件", "资源库", "设备", "需要你", "记忆", "技能", "成本", "设置"]));
  });

  it("多词 AND 过滤页面 / 成员 / 工单", () => {
    expect(searchAll(src, "团队")[0]).toMatchObject({ group: "页面", to: "/crew" });
    expect(searchAll(src, "小码").some((x) => x.group === "成员" && x.label === "小码")).toBe(true);
    expect(searchAll(src, "写退款接口").find((x) => x.group === "工单")?.to).toBe("/task/task-refund-api");
    expect(searchAll(src, "zzzz-not-exist")).toEqual([]);
  });

  it("成员：Pip 去主线，有工单的成员去最近工单，其余去团队页", () => {
    expect(searchAll(src, "Pip").find((x) => x.id === "bot:bot-pip")?.to).toBe("/");
    const taskBots = new Set(tasks.map((t) => t.botId));
    for (const b of bots.filter((x) => x.id !== "bot-pip")) {
      const to = searchAll(src, b.name).find((x) => x.id === `bot:${b.id}`)?.to;
      if (taskBots.has(b.id)) expect(to).toMatch(/^\/task\//);
      else expect(to).toBe("/crew");
    }
  });

  it("对话：只搜已加载消息，结果指向所在线程并带 msg 参数", () => {
    const r = searchAll(src, "退款流程").filter((x) => x.group === "对话");
    expect(r).toHaveLength(2);
    expect(r[0]!.to).toBe("/?msg=e2");
    expect(r[0]!.hint).toBeTruthy();
    expect(searchAll({ ...src, entries: {} }, "退款流程").some((x) => x.group === "对话")).toBe(false);
  });
});

describe("全局搜索浮层", () => {
  it("Ctrl+K 打开，输入后 Enter 打开所选项，Esc 关闭", async () => {
    mountShell("/");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "搜索" });
    fireEvent.change(input, { target: { value: "团队" } });
    await waitFor(() => expect(screen.getAllByRole("option")[0]?.textContent).toContain("团队"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(loc()).toBe("/crew");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Esc 关闭后焦点回到打开前的元素", async () => {
    mountShell("/");
    const btn = screen.getByRole("button", { name: "搜索" });
    btn.focus();
    fireEvent.click(btn);
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it("↑↓ 移动选中；点击工单 / 成员跳转到具体对象", async () => {
    mountShell("/");
    await waitFor(() => expect(Object.keys(useHub.getState().model.tasks).length).toBeGreaterThan(0));
    act(() => useCommandSearch.getState().setOpen(true));
    let input = await screen.findByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.change(input, { target: { value: "写退款接口" } });
    fireEvent.click(await screen.findByRole("option", { name: /写退款接口/ }));
    expect(loc()).toBe("/task/task-refund-api");

    act(() => useCommandSearch.getState().setOpen(true));
    input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "小码" } });
    fireEvent.click((await screen.findAllByRole("option", { name: /小码/ }))[0]!);
    expect(loc()).toMatch(/^\/task\//);
  });

  it("空结果与加载态", async () => {
    mountShell();
    act(() => useCommandSearch.getState().setOpen(true));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "zzzzzz" } });
    expect(await screen.findByText(/没有找到/)).toBeTruthy();
    cleanup();
    teardownShell();

    resetShellState();
    mountShell();
    act(() => useHub.setState({ status: "connecting", model: { ...useHub.getState().model, bots: {} } }));
    act(() => useCommandSearch.getState().setOpen(true));
    expect(await screen.findByText("正在加载…")).toBeTruthy();
  });
});
