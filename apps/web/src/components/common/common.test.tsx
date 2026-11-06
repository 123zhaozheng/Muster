import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Approval, Bot, Entry } from "@muster/protocol";
import { setReduceMotion } from "@muster/ui";
import { ApprovalNotice, BotStatusBadge, MemberAvatar, MessageItem, ProcessFold, TaskGroup, TaskRow, TaskStatusBadge, ThinkingBlock, blockSpeaker, buildStream, formatSpan, processLabel, sourceLabel, thinkingLabel, toolCallCount } from "./index";

afterEach(cleanup);

const bot: Pick<Bot, "name" | "shape" | "color" | "status"> = { name: "小码", shape: "square", color: "mint", status: "working" };
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("MemberAvatar / 状态徽标", () => {
  it("按 bot 取形状、颜色、状态，并以名字作为可访问名称", () => {
    render(<MemberAvatar bot={bot} />);
    const svg = screen.getByRole("img", { name: "小码" });
    expect(svg.getAttribute("data-shape")).toBe("square");
    expect(svg.getAttribute("data-color")).toBe("mint");
    expect(svg.getAttribute("data-status")).toBe("working");
  });

  it("statusDot 以文字标注成员状态", () => {
    render(<MemberAvatar bot={{ ...bot, status: "waiting_approval" }} statusDot />);
    expect(screen.getByRole("img", { name: "等你确认" })).toBeTruthy();
  });

  it("头像是活的；忙碌/等你时状态点脉冲，空闲不脉冲；减少动态效果时全部静止", () => {
    const { rerender } = render(<MemberAvatar bot={bot} statusDot />);
    expect(screen.getByRole("img", { name: "小码" }).getAttribute("data-motion")).toBe("live");
    expect(screen.getByRole("img", { name: "工作中" }).classList.contains("muster-ping")).toBe(true);
    rerender(<MemberAvatar bot={{ ...bot, status: "idle" }} statusDot />);
    expect(screen.getByRole("img", { name: "空闲" }).classList.contains("muster-ping")).toBe(false);
    act(() => setReduceMotion(true));
    try {
      rerender(<MemberAvatar bot={bot} statusDot />);
      expect(screen.getByRole("img", { name: "工作中" }).classList.contains("muster-ping")).toBe(false);
      expect(screen.getByRole("img", { name: "小码" }).getAttribute("data-motion")).toBe("still");
    } finally {
      act(() => setReduceMotion(false));
    }
  });

  it("TaskStatusBadge / BotStatusBadge 显示统一文案", () => {
    render(
      <div>
        <TaskStatusBadge status="running" />
        <TaskStatusBadge status="waiting_approval" />
        <BotStatusBadge status="sleeping" />
      </div>,
    );
    expect(screen.getByText("执行中")).toBeTruthy();
    expect(screen.getByText("等你确认")).toBeTruthy();
    expect(screen.getByText("休息中")).toBeTruthy();
  });
});

describe("MessageItem", () => {
  it("你的消息：右对齐浅底气泡、无头像；时间和复制只在悬停行出现", () => {
    const { container } = render(<MessageItem role="user" time="09:30" copyText="你好">你好</MessageItem>);
    expect(container.firstElementChild!.className).toContain("items-end");
    const bubble = screen.getByTestId("user-bubble");
    expect(bubble.textContent).toBe("你好");
    expect(bubble.className).toContain("bg-surface-muted");
    expect(bubble.className).toContain("rounded-card");
    expect(screen.queryByRole("img")).toBeNull();
    const actions = screen.getByTestId("message-actions");
    expect(actions.className).toContain("opacity-0");
    expect(actions.className).toContain("group-hover/msg:opacity-100");
    expect(within(actions).getByText("09:30")).toBeTruthy();
    expect(within(actions).getByRole("button", { name: "复制" })).toBeTruthy();
  });

  it("Pip / 成员：无气泡；一行“24px 头像 · 名字 · 来源”；正文 15px/1.7、行长 ≤40em", () => {
    render(<MessageItem role="member" bot={bot} source="Codex" time="09:30">处理中</MessageItem>);
    const speaker = screen.getByTestId("speaker");
    expect(speaker.textContent).toBe("小码· Codex");
    expect(within(speaker).getByRole("img", { name: "小码" }).getAttribute("width")).toBe("24");
    const body = screen.getByText("处理中");
    expect(body.className).toContain("text-body");
    expect(body.className).toContain("max-w-[40em]");
    expect(body.className).not.toContain("border");
    expect(body.className).not.toContain("bg-");
    expect(within(screen.getByTestId("message-actions")).getByText("09:30")).toBeTruthy();
  });

  it("同一位连续说话时不重复头像行；流式显示光标且不提供复制", () => {
    render(<MessageItem role="pip" bot={{ ...bot, name: "Pip" }} showHeader={false} copyText="写到一半" streaming>写到一半</MessageItem>);
    expect(screen.queryByTestId("speaker")).toBeNull();
    expect(screen.getByRole("status", { name: "正在输入" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "复制" })).toBeNull();
  });

  it("sourceLabel：成员写引擎，Pip 不写", () => {
    expect(sourceLabel({ kind: "codex", engineLabel: "Codex" })).toBe("Codex");
    expect(sourceLabel({ kind: "main", engineLabel: "主 Bot · 只做分发" })).toBeUndefined();
    expect(sourceLabel(undefined)).toBeUndefined();
  });
});

describe("ThinkingBlock", () => {
  it("用时文案：秒数四舍五入且至少 1s，超过一分钟带分钟，没有用时只写“已思考”", () => {
    expect(thinkingLabel(8_400)).toBe("已思考 8s");
    expect(thinkingLabel(120)).toBe("已思考 1s");
    expect(thinkingLabel(65_000)).toBe("已思考 1m 05s");
    expect(thinkingLabel(undefined)).toBe("已思考");
  });

  it("完成后默认折叠成一行“已思考 Xs”，点击展开全文，再点收起", () => {
    render(<ThinkingBlock text={"先看回调\n再改验签"} durationMs={8_000} />);
    const toggle = screen.getByRole("button", { name: /已思考 8s/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/先看回调/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const body = screen.getByText(/先看回调/);
    expect(body.textContent).toBe("先看回调\n再改验签");
    expect(body.className).toContain("border-l-2");
    expect(body.className).toContain("max-h-[min(40vh,320px)]");
    expect(body.className).toContain("overflow-y-auto");
    expect(toggle.getAttribute("aria-controls")).toBe(body.id);
    fireEvent.click(toggle);
    expect(screen.queryByText(/先看回调/)).toBeNull();
  });

  it("思考中：折叠显示“思考中”和动画点，也能展开看到已有内容；减少动态效果时点不动", () => {
    render(<ThinkingBlock text="正在比较两种方案" streaming />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("思考中");
    expect(screen.queryByText(/已思考/)).toBeNull();
    expect(status.querySelectorAll(".animate-pulse")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /思考中/ }));
    expect(screen.getByText("正在比较两种方案")).toBeTruthy();
    act(() => setReduceMotion(true));
    try {
      expect(screen.getByRole("status").querySelectorAll(".animate-pulse")).toHaveLength(0);
    } finally {
      act(() => setReduceMotion(false));
    }
  });

  it("流式且知道开始时间：显示“思考中 · Ns”", () => {
    render(<ThinkingBlock text="" streaming startedAt={new Date(Date.now() - 8_000).toISOString()} />);
    expect(screen.getByRole("status").textContent).toContain("思考中 · 8s");
  });

  it("没有思考文字（被隐去）时只显示用时，不能展开", () => {
    render(<ThinkingBlock text="" durationMs={3_000} />);
    const toggle = screen.getByRole("button", { name: "已思考 3s" }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBeNull();
  });
});

describe("TaskRow / TaskGroup", () => {
  const task = { id: "task-1", title: "修复支付回调", status: "done" as const, progress: undefined };

  it("默认收起成一行：状态图标、头像、“成员 · 标题”、用时、箭头；点开才有摘要与“查看详情”", () => {
    wrap(
      <TaskGroup aria-label="派发">
        <TaskRow task={task} bot={bot} summary="12 项测试通过" elapsedMs={130_000} />
      </TaskGroup>,
    );
    const group = within(screen.getByRole("group", { name: "派发" }));
    const row = group.getByRole("button", { name: /小码 · 修复支付回调/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(group.getByRole("img", { name: "已完成" })).toBeTruthy();
    expect(group.getByRole("img", { name: "小码" }).getAttribute("width")).toBe("20");
    expect(group.getByText("2m10s")).toBeTruthy();
    expect(group.queryByText("12 项测试通过")).toBeNull();
    expect(group.queryByRole("link")).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(group.getByText("12 项测试通过").className).toContain("line-clamp-3");
    expect(group.getByRole("link", { name: "查看详情：修复支付回调" }).getAttribute("href")).toBe("/task/task-1");
    fireEvent.click(row);
    expect(group.queryByText("12 项测试通过")).toBeNull();
  });

  it("没有真实结果文字时，展开后只给出由状态推出的阶段，不伪造进度", () => {
    wrap(<TaskRow task={{ ...task, status: "running" }} bot={bot} />);
    expect(screen.getByRole("img", { name: "执行中" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /修复支付回调/ }));
    expect(screen.getByText("正在执行")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("task.progress 不可靠：即使带了数值也不画进度条、不显示百分比", () => {
    const running = { ...task, status: "running" as const, progress: 42 };
    wrap(<TaskRow task={running} bot={bot} />);
    fireEvent.click(screen.getByRole("button", { name: /修复支付回调/ }));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

describe("ProcessFold", () => {
  it("“已处理 N 步 · 用时”，默认收起，点开看过程", () => {
    expect(processLabel(5, 130_000)).toBe("已处理 5 步 · 2m10s");
    expect(processLabel(2)).toBe("已处理 2 步");
    render(<ProcessFold steps={5} durationMs={130_000}><div>过程内容</div></ProcessFold>);
    const toggle = screen.getByRole("button", { name: "已处理 5 步 · 2m10s" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("过程内容")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("过程内容")).toBeTruthy();
  });
});

describe("消息流分组 buildStream", () => {
  const T0 = Date.parse("2026-11-06T08:00:00Z");
  let n = 0;
  const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
  const mk = (sec: number, body: Record<string, unknown>) => ({ id: `e${n++}`, threadId: "t", ts: at(sec), ...body }) as Entry;
  const user = (sec: number, text = "问") => mk(sec, { kind: "user", text });
  const think = (sec: number, extra: Record<string, unknown> = {}) => mk(sec, { kind: "thinking", botId: "pip", text: "想", durationMs: 2_000, ...extra });
  const tool = (sec: number, items = [{ tool: "bash", label: "pnpm test", ok: true }]) => mk(sec, { kind: "tool_summary", botId: "pip", reads: 0, commands: items.length, edits: 0, items });
  const say = (sec: number, text: string, extra: Record<string, unknown> = {}) => mk(sec, { kind: "bot", botId: "pip", text, ...extra });

  it("formatSpan / toolCallCount", () => {
    expect([8_000, 130_000, 120_000, 3_900_000].map(formatSpan)).toEqual(["8s", "2m10s", "2m", "1h05m"]);
    expect(toolCallCount({ reads: 6, commands: 2, edits: 0, items: [] })).toBe(8);
    expect(toolCallCount({ reads: 0, commands: 0, edits: 0, items: [{ tool: "route", label: "x" }] })).toBe(1);
  });

  it("结束的一轮：思考、工具、中间文字收成一个过程块（按调用计步，用时从你的消息到最终回答），最终回答保留", () => {
    const entries = [user(0), think(1), tool(5, [{ tool: "read", label: "a", ok: true }, { tool: "bash", label: "b", ok: true }]), say(20, "我先看看"), tool(40), say(130, "完成了")];
    const blocks = buildStream(entries, false);
    expect(blocks.map((b) => b.type)).toEqual(["entry", "process", "entry"]);
    const fold = blocks[1]!;
    if (fold.type !== "process") throw new Error();
    expect(fold.steps).toBe(1 + 2 + 1 + 1);
    expect(fold.durationMs).toBe(130_000);
    expect(fold.blocks.map((b) => b.type)).toEqual(["entry", "tools", "entry", "tools"]);
    expect(blocks[2]!.type === "entry" && blocks[2]!.entry.kind === "bot" && blocks[2]!.entry.text).toBe("完成了");
  });

  it("进行中的最后一轮不折叠，连续工具调用合成一组并标为进行中；之前已结束的轮照常折叠", () => {
    const entries = [user(0), think(1), tool(2), say(3, "好了"), user(10), think(11), tool(12), tool(13)];
    const blocks = buildStream(entries, true);
    expect(blocks.map((b) => b.type)).toEqual(["entry", "process", "entry", "entry", "entry", "tools"]);
    const last = blocks.at(-1)!;
    expect(last.type === "tools" && last.entries.length).toBe(2);
    expect(last.type === "tools" && last.running).toBe(true);
    expect(buildStream(entries, false).at(-1)!.type).toBe("process");
  });

  it("流式中的轮不折叠；过程不足 2 步不折叠；派发、确认照常显示并合并连续派发", () => {
    expect(buildStream([user(0), think(1), say(2, "写到一半", { streaming: true })], false).map((b) => b.type)).toEqual(["entry", "entry", "entry"]);
    expect(buildStream([user(0), think(1), say(2, "答")], false).map((b) => b.type)).toEqual(["entry", "entry", "entry"]);
    const d = (sec: number) => mk(sec, { kind: "dispatch", botId: "bot-x", taskId: `task-${sec}`, title: "t" });
    const ap = mk(9, { kind: "approval", approvalId: "ap" });
    const blocks = buildStream([user(0), think(1), tool(2), say(3, "安排"), d(4), d(5), ap, say(10, "汇报")], false);
    expect(blocks.map((b) => b.type)).toEqual(["entry", "process", "dispatches", "entry", "entry"]);
    expect(blocks[2]!.type === "dispatches" && blocks[2]!.entries.length).toBe(2);
  });

  it("blockSpeaker：你的消息为 user，成员内容为 botId，派发与确认是中性的", () => {
    const [u, p, , ds] = buildStream([user(0), say(1, "嗯"), mk(2, { kind: "approval", approvalId: "a" }), mk(3, { kind: "dispatch", botId: "bot-x", taskId: "t", title: "t" })], false);
    expect(blockSpeaker(u!)).toBe("user");
    expect(blockSpeaker(p!)).toBe("pip");
    expect(blockSpeaker(ds!)).toBeNull();
  });
});

describe("ApprovalNotice", () => {
  const approval: Pick<Approval, "id" | "title" | "status"> = { id: "ap 1", title: "阿克 想运行 pnpm install", status: "pending" };

  it("待确认：一行琥珀提示“… · 在下方确认”，没有按钮，收件箱链接只是次要入口", () => {
    const { container } = wrap(<ApprovalNotice approval={approval} />);
    expect(container.textContent).toContain("阿克 想运行 pnpm install · 在下方确认");
    expect((container.firstElementChild as HTMLElement).className).toContain("bg-warning-surface");
    expect(screen.getByRole("link", { name: "在收件箱查看：阿克 想运行 pnpm install" }).getAttribute("href")).toBe("/inbox?id=ap%201");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("已处理：显示结果文字，不再是琥珀色", () => {
    const { container } = wrap(<ApprovalNotice approval={{ ...approval, status: "denied" }} />);
    expect(container.textContent).toContain("阿克 想运行 pnpm install · 已拒绝");
    expect((container.firstElementChild as HTMLElement).className).not.toContain("bg-warning-surface");
  });
});
