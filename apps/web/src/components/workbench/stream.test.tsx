import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Entry, ToolItem } from "@muster/protocol";
import type { ToolEntry } from "../common";
import { EntryStream } from "./EntryView";
import { ToolRow } from "./ToolRow";
import { seedHub } from "./testHarness";

afterEach(cleanup);

let n = 0;
const T0 = Date.parse("2026-11-06T08:00:00Z");
const mk = (sec: number, body: Record<string, unknown>) => ({ id: `s${n++}`, threadId: "thread-fix-callback", ts: new Date(T0 + sec * 1000).toISOString(), ...body }) as Entry;
const tool = (sec: number, items: ToolItem[], counts = { reads: 0, commands: items.length, edits: 0 }) => mk(sec, { kind: "tool_summary", botId: "bot-xiaoma", ...counts, items }) as ToolEntry;

describe("ToolRow", () => {
  it("只有一次调用：一行“图标 · 白话动作 · 对象”，点开看工具名、参数与结果", () => {
    render(<ToolRow entries={[tool(0, [{ tool: "bash", label: "pnpm test", ok: true, output: "12 passed" }])]} />);
    const line = screen.getByRole("button", { name: /运行\s*pnpm test/ });
    expect(screen.queryByText(/共 \d+ 次调用/)).toBeNull();
    expect(screen.queryByText("12 passed")).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText("bash · pnpm test")).toBeTruthy();
    expect(screen.getByText("12 passed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制输出" })).toBeTruthy();
  });

  it("连续调用合成一行“共 N 次调用 · M 次失败”，默认收起；明细不全时如实说明", () => {
    const entries = [
      tool(0, [{ tool: "read", label: "a.ts", ok: true }, { tool: "bash", label: "pnpm lint", ok: false, output: "1 error" }], { reads: 5, commands: 1, edits: 0 }),
      tool(3, [{ tool: "grep", label: "verify", ok: true }]),
    ];
    render(<ToolRow entries={entries} />);
    const head = screen.getByRole("button", { name: /共 7 次调用/ });
    expect(head.textContent).toContain("1 次失败");
    expect(head.getAttribute("title")).toBe("读取了 5 个文件 · 运行了 2 条命令");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    expect(screen.getByRole("button", { name: /读取\s*a\.ts/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /搜索\s*verify/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: "失败" })).toBeTruthy();
    expect(screen.getByText("另有 4 次调用没有记录细节")).toBeTruthy();
  });

  it("进行中默认展开、最后一条转圈；结束后自动收起", () => {
    const entries = [tool(0, [{ tool: "read", label: "a.ts", ok: true }, { tool: "bash", label: "pnpm test" }])];
    const { rerender } = render(<ToolRow entries={entries} running />);
    const head = screen.getByRole("button", { name: /共 2 次调用/ });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByRole("button", { name: /运行\s*pnpm test/ })).getByRole("img", { name: "进行中" })).toBeTruthy();
    rerender(<ToolRow entries={entries} running={false} />);
    expect(screen.getByRole("button", { name: /共 2 次调用/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /运行\s*pnpm test/ })).toBeNull();
  });
});

describe("EntryStream（工单详情消息流）", () => {
  beforeEach(() => void seedHub());
  const noop = () => {};
  const renderStream = (entries: Entry[], live: boolean, onFork = vi.fn()) =>
    render(
      <MemoryRouter>
        <EntryStream entries={entries} live={live} onFork={onFork} onOpenDiff={noop} onChoose={noop} />
      </MemoryRouter>,
    );

  const turn = () => [
    mk(0, { kind: "user", text: "修一下回调" }),
    mk(1, { kind: "thinking", botId: "bot-xiaoma", text: "先看验签", durationMs: 4_000 }),
    mk(2, { kind: "bot", botId: "bot-xiaoma", text: "我先看看代码" }),
    tool(3, [{ tool: "read", label: "callback.ts", ok: true }, { tool: "bash", label: "pnpm test", ok: true }]),
    mk(130, { kind: "bot", botId: "bot-xiaoma", text: "已修复，测试通过" }),
  ];

  it("结束的一轮折叠为“已处理 N 步 · 用时”，最终回答可见；头像行只出现一次", () => {
    renderStream(turn(), false);
    const fold = screen.getByRole("button", { name: "已处理 4 步 · 2m10s" });
    expect(screen.getByText("已修复，测试通过")).toBeTruthy();
    expect(screen.queryByText("我先看看代码")).toBeNull();
    expect(screen.getAllByTestId("speaker")).toHaveLength(1);
    expect(screen.getByTestId("speaker").textContent).toBe("小码· Codex");
    fireEvent.click(fold);
    expect(screen.getByText("我先看看代码")).toBeTruthy();
    expect(screen.getByRole("button", { name: /已思考 4s/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /共 2 次调用/ })).toBeTruthy();
    expect(screen.getAllByTestId("speaker")).toHaveLength(1);
  });

  it("仍在工作时不折叠，工具调用组保持展开；“从这里分支”指向组里最后一条", () => {
    const onFork = vi.fn();
    const entries = turn().slice(0, 4);
    renderStream(entries, true, onFork);
    expect(screen.queryByRole("button", { name: /已处理/ })).toBeNull();
    expect(screen.getByRole("button", { name: /共 2 次调用/ }).getAttribute("aria-expanded")).toBe("true");
    const group = document.querySelector(`[data-entry-id="${entries[3]!.id}"]`) as HTMLElement;
    fireEvent.click(within(group).getByRole("button", { name: "从这里分支" }));
    expect(onFork).toHaveBeenCalledWith(entries[3]!.id);
  });
});
