import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { MAIN_THREAD_ID, type ModelSettings } from "@muster/protocol";
import { entriesByThread, snapshot } from "@muster/protocol/fixtures";
import { emptyModel, modelFromSnapshot } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { useHub } from "../../lib/hub";
import { EXAMPLE_PROMPTS } from "../../components/home/Welcome";
import { activeMention } from "../../components/home/Composer";
import { serverNow } from "../../components/home/serverClock";
import { clockLabel, formatDuration, formatElapsed, greetingFor, isSameLocalDay, nextDailyRun, relativeAgo, summaryLine, taskTimeText } from "../../components/home/time";
import HomePage from "./index";

const request = vi.fn();

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}<span data-testid="search">{loc.search}</span></div>;
}

function setup(opts: { withEntries?: boolean; modelSettings?: ModelSettings } = {}) {
  const client = { request, onPush: () => () => {}, onStatus: () => () => {}, close() {} } as unknown as MusterClient;
  const model = {
    ...modelFromSnapshot(structuredClone(snapshot)),
    entries: opts.withEntries === false ? {} : structuredClone(entriesByThread),
    modelSettings: opts.modelSettings ?? {},
  };
  useHub.setState({ model, status: "open", client, loadedThreads: { [MAIN_THREAD_ID]: true } });
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ entryId: "e-x" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useHub.setState({ model: emptyModel(), status: "connecting", client: null, loadedThreads: {} });
});

describe("主线页", () => {
  it("渲染 Hero 问候与概况、对话、两张派发卡与选项", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: new RegExp(`^${greetingFor(new Date().getHours())}，Pip`) })).toBeTruthy();
    expect(screen.getByText("3 个任务进行中，1 件事等你")).toBeTruthy();
    expect(screen.getByText(/shop-api 里两件事/)).toBeTruthy();
    expect(screen.getByText("好的，我来安排一下：")).toBeTruthy();
    const cards = screen.getAllByRole("link", { name: /^打开任务：/ });
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("小码")).toBeTruthy();
    expect(within(cards[0]!).getByText("工作中")).toBeTruthy();
    expect(within(cards[0]!).getByText("70%")).toBeTruthy();
    expect(within(cards[1]!).getByText("等你审批")).toBeTruthy();
    expect(screen.getByRole("button", { name: "顺便跑测试" })).toBeTruthy();
  });

  it("Hero 统计卡：进行中 / 待审批 / 今日完成 / 本周花费", () => {
    setup();
    const hero = screen.getByRole("region", { name: "今日概况" });
    expect(within(hero).getByText("进行中")).toBeTruthy();
    expect(within(hero).getByText("待审批")).toBeTruthy();
    expect(within(hero).getByText("今日完成")).toBeTruthy();
    expect(within(hero).getByText("本周花费")).toBeTruthy();
    expect(hero.querySelector('[data-value="3"]')).toBeTruthy(); // 进行中 3
    expect(within(hero).getByLabelText("$6.97")).toBeTruthy(); // 2.18+1.24+1.87+0.72+0.96
  });

  it("派发卡：引擎/模型标签、实时进度条、校正后的已用时间", () => {
    setup();
    act(() => useHub.setState((s) => ({
      model: { ...s.model, bots: { ...s.model.bots, "bot-xiaoma": { ...s.model.bots["bot-xiaoma"]!, model: { provider: "deepseek", modelId: "deepseek-chat" } } } },
    })));
    const [first, second] = screen.getAllByRole("link", { name: /^打开任务：/ });
    expect(within(first!).getByText("Codex")).toBeTruthy();
    expect(within(first!).getByText("deepseek-chat")).toBeTruthy();
    expect(within(first!).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("70");
    // fixture 的 startedAt 在固定日期；serverTime 校正后已用时间应是 32 / 41 分钟，而不是几个月
    expect(within(first!).getByText(/已用 32 分 \d\d 秒 · 预计还需/)).toBeTruthy();
    expect(within(second!).getByText(/已用 41 分 \d\d 秒/)).toBeTruthy();
  });

  it("进行中的派发卡每秒刷新已用时间，进度更新会反映到进度条", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(Date.parse("2026-11-06T10:00:00Z"));
    setup();
    const card = () => screen.getAllByRole("link", { name: /^打开任务：/ })[0]!;
    expect(within(card()).getByText(/已用 32 分 00 秒/)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(5000));
    expect(within(card()).getByText(/已用 32 分 05 秒/)).toBeTruthy();
    act(() => useHub.setState((s) => ({ model: { ...s.model, tasks: { ...s.model.tasks, "task-fix-callback": { ...s.model.tasks["task-fix-callback"]!, progress: 85 } } } })));
    expect(within(card()).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("85");
  });

  it("点击派发卡跳转到工作台", () => {
    setup();
    fireEvent.click(screen.getAllByRole("link", { name: /^打开任务：/ })[0]!);
    expect(screen.getByTestId("where").textContent).toContain("/task/task-fix-callback");
  });

  it("右栏：团队在线成员墙与各区块“查看全部”", () => {
    setup();
    const team = screen.getByRole("region", { name: "团队在线" });
    for (const n of ["小码", "阿克", "小探", "小文"]) expect(within(team).getByText(n)).toBeTruthy();
    expect(within(team).getByText("3/4")).toBeTruthy(); // 小探在睡眠，其余在线
    fireEvent.click(within(team).getByRole("button", { name: "查看全部团队在线" }));
    expect(screen.getByTestId("where").textContent).toContain("/crew");
  });

  it("右栏：日程显示 cron 的下一次时间", () => {
    setup();
    expect(within(screen.getByRole("region", { name: "日程" })).getByText(/^下次 (今天|明天) 09:00$/)).toBeTruthy();
  });

  it("右栏：进行中、需要你(审批卡)、日程、已连接电脑", () => {
    setup();
    const active = screen.getByRole("region", { name: "进行中" });
    expect(within(active).getByText("修支付回调 bug")).toBeTruthy();
    expect(within(active).getByText("写退款接口")).toBeTruthy();
    const needs = screen.getByRole("region", { name: "需要你" });
    expect(within(needs).getByText("阿克 想运行 pnpm install")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "日程" })).getByText("每日 09:00 晨间简报")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "已连接电脑" })).getByText("书房台式机")).toBeTruthy();
  });

  it("审批卡出现在对话中，点允许发出 approval.resolve", () => {
    setup();
    act(() => useHub.setState((s) => ({
      model: { ...s.model, entries: { ...s.model.entries, [MAIN_THREAD_ID]: [...s.model.entries[MAIN_THREAD_ID]!, { id: "e-ap", threadId: MAIN_THREAD_ID, ts: new Date().toISOString(), kind: "approval", approvalId: "ap-1" }] } },
    })));
    const cards = screen.getAllByText("阿克 想运行 pnpm install");
    expect(cards.length).toBe(2); // 对话 + 右栏
    fireEvent.click(screen.getAllByRole("button", { name: "允许" })[0]!);
    expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-1", decision: "allow" });
  });

  it("点选项把文字填入输入框，可继续修改", () => {
    setup();
    const input = screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "顺便跑测试" }));
    expect(input.value).toBe("顺便跑测试");
    fireEvent.click(screen.getByRole("button", { name: "完成后通知我" }));
    expect(input.value).toBe("顺便跑测试，完成后通知我");
  });

  it("Enter 发送并调用 chat.send；Shift+Enter 不发送", async () => {
    setup();
    const input = screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好 Pip" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(request).toHaveBeenCalledWith("chat.send", { threadId: MAIN_THREAD_ID, text: "你好 Pip" });
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("空输入时发送按钮不可用", () => {
    setup();
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("发送失败时恢复草稿并提示", async () => {
    request.mockRejectedValueOnce(new Error("not connected"));
    setup();
    const input = screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByText(/发送失败/)).toBeTruthy());
    expect(input.value).toBe("hi");
  });

  it("发送中按钮显示加载并禁用", async () => {
    let resolve!: (v: unknown) => void;
    request.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    setup();
    const input = screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const btn = (await screen.findByRole("button", { name: "发送" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    await act(async () => resolve({ entryId: "e" }));
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBeNull());
  });

  it("流式 bot 消息显示光标", () => {
    setup({ withEntries: false });
    act(() => useHub.setState((s) => ({
      model: { ...s.model, entries: { [MAIN_THREAD_ID]: [{ id: "s1", threadId: MAIN_THREAD_ID, ts: new Date().toISOString(), kind: "bot", botId: "bot-pip", text: "**加粗**正在写", streaming: true }] } },
    })));
    expect(screen.getByLabelText("正在输入")).toBeTruthy();
    expect(screen.getByText("加粗").tagName).toBe("STRONG");
  });

  it("Pip 思考中且没有流式消息时显示思考提示", () => {
    setup();
    act(() => useHub.setState((s) => ({ model: { ...s.model, bots: { ...s.model.bots, "bot-pip": { ...s.model.bots["bot-pip"]!, status: "thinking" } } } })));
    expect(screen.getByRole("status", { name: "正在思考" })).toBeTruthy();
  });

  it("空主线显示欢迎态，点示例填入输入框", () => {
    setup({ withEntries: false });
    expect(screen.getByText("嗨，我是 Pip")).toBeTruthy();
    fireEvent.click(screen.getByText(/每天早上 9 点/));
    expect((screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement).value).toMatch(/每天早上 9 点/);
  });

  it("欢迎态至少 6 个示例，覆盖编程、研究、办公、定时、PR", () => {
    setup({ withEntries: false });
    expect(EXAMPLE_PROMPTS.length).toBeGreaterThanOrEqual(6);
    for (const p of EXAMPLE_PROMPTS) expect(screen.getByText(p.text)).toBeTruthy();
    for (const t of ["编程", "研究", "办公", "定时任务", "盯着 PR"]) expect(EXAMPLE_PROMPTS.some((p) => p.title === t)).toBe(true);
  });

  it("未配置模型时显示引导卡，点击去 设置 · 模型", () => {
    setup({ withEntries: false });
    const card = screen.getByRole("region", { name: "模型未配置" });
    fireEvent.click(within(card).getByRole("button", { name: "去配置模型" }));
    expect(screen.getByTestId("where").textContent).toContain("/settings");
    expect(screen.getByTestId("search").textContent).toBe("?tab=models");
  });

  it("已配置 router 或 native 模型时不再显示引导卡", () => {
    setup({ withEntries: false, modelSettings: { native: { provider: "deepseek", modelId: "deepseek-chat" } } });
    expect(screen.queryByRole("region", { name: "模型未配置" })).toBeNull();
    cleanup();
    setup({ modelSettings: { router: { provider: "deepseek", modelId: "deepseek-chat" } } });
    expect(screen.queryByRole("region", { name: "模型未配置" })).toBeNull();
  });

  it("有对话但未配置模型时显示紧凑提示", () => {
    setup();
    expect(screen.getByRole("region", { name: "模型未配置" })).toBeTruthy();
  });

  it("输入 @ 弹出成员选择，选中后插入“交给<名字>”", () => {
    setup();
    const input = screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "@" } });
    const list = screen.getByRole("listbox", { name: "选择成员" });
    expect(within(list).getAllByRole("option")).toHaveLength(4); // Pip 自己不在列表里
    expect(within(list).queryByText("Pip")).toBeNull();
    fireEvent.change(input, { target: { value: "@小" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(3); // 小码 小探 小文
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByText("小码"));
    expect(input.value).toBe("交给小码 ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("@ 菜单用键盘选择，Enter 选中而不发送；Esc 关闭", () => {
    setup();
    const input = screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "帮我 @阿" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(request).not.toHaveBeenCalled();
    expect(input.value).toBe("帮我 交给阿克 ");
    fireEvent.change(input, { target: { value: "x @" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("工具栏 @ 按钮在光标处插入 @", () => {
    setup();
    const input = screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "@ 提及成员" }));
    expect(input.value).toBe("你好 @");
  });

  it("右栏空状态友好", () => {
    setup({ withEntries: false });
    act(() => useHub.setState((s) => ({ model: { ...s.model, tasks: {}, approvals: {}, triggers: {}, devices: {} } })));
    expect(screen.getByText(/暂时没有进行中的任务/)).toBeTruthy();
    expect(screen.getByText(/没有等你处理的事/)).toBeTruthy();
    expect(screen.getByText(/还没有定时任务/)).toBeTruthy();
    expect(screen.getByText(/还没有连接的电脑/)).toBeTruthy();
    expect(screen.getByText("手头暂时清闲，想让我安排点什么？")).toBeTruthy();
  });
});

describe("time 工具", () => {
  it("formatDuration / relativeAgo", () => {
    expect(formatDuration(20_000)).toBe("不到 1 分钟");
    expect(formatDuration(5 * 60_000)).toBe("5 分钟");
    expect(formatDuration(80 * 60_000)).toBe("1 小时 20 分钟");
    expect(formatDuration(3 * 24 * 3_600_000)).toBe("3 天");
    const now = Date.parse("2026-11-06T10:00:00Z");
    expect(relativeAgo("2026-11-06T09:55:00Z", now)).toBe("5 分钟前");
    expect(relativeAgo("2026-11-06T10:00:00Z", now)).toBe("刚刚");
    expect(relativeAgo("2026-11-04T10:00:00Z", now)).toBe("2 天前");
  });

  it("formatElapsed", () => {
    expect(formatElapsed(0)).toBe("0 秒");
    expect(formatElapsed(42_000)).toBe("42 秒");
    expect(formatElapsed(5 * 60_000 + 7_000)).toBe("5 分 07 秒");
    expect(formatElapsed(80 * 60_000)).toBe("1 小时 20 分");
    expect(formatElapsed(2 * 24 * 3_600_000 + 3 * 3_600_000)).toBe("2 天 3 小时");
    expect(formatElapsed(-5000)).toBe("0 秒");
  });

  it("nextDailyRun", () => {
    const now = Date.parse("2026-11-06T02:00:00Z"); // 上海 10:00
    expect(nextDailyRun("0 9 * * *", "Asia/Shanghai", now)).toBe("明天 09:00");
    expect(nextDailyRun("30 18 * * *", "Asia/Shanghai", now)).toBe("今天 18:30");
    expect(nextDailyRun("*/5 * * * *", "Asia/Shanghai", now)).toBeNull();
  });

  it("taskTimeText", () => {
    const now = Date.parse("2026-11-06T10:00:00Z");
    const base = { id: "t", title: "x", botId: "b", threadId: "th", parentThreadId: "p", startedAt: "2026-11-06T09:30:00Z" } as const;
    expect(taskTimeText({ ...base, status: "running", progress: 50 }, now)).toBe("已用 30 分 00 秒 · 预计还需 30 分钟");
    // 刚开始的任务不再显示“已用 1 分钟”，而是实际秒数
    expect(taskTimeText({ ...base, status: "running", progress: 0, startedAt: "2026-11-06T09:59:42Z" }, now)).toBe("已用 18 秒");
    expect(taskTimeText({ ...base, status: "done", finishedAt: "2026-11-06T09:50:00Z" }, now)).toBe("用时 20 分钟");
  });

  it("greetingFor / summaryLine", () => {
    expect([8, 12, 15, 20, 2].map(greetingFor)).toEqual(["早上好", "中午好", "下午好", "晚上好", "夜深了"]);
    expect(summaryLine(3, 1)).toBe("3 个任务进行中，1 件事等你");
    expect(summaryLine(2, 0)).toBe("2 个任务进行中，没有需要你处理的事");
    expect(summaryLine(0, 2)).toBe("2 件事等你");
    expect(summaryLine(0, 0)).toMatch(/清闲/);
  });

  it("clockLabel / isSameLocalDay", () => {
    const now = new Date(2026, 10, 6, 15, 0).getTime();
    expect(clockLabel(new Date(2026, 10, 6, 9, 5).toISOString(), now)).toBe("09:05");
    expect(clockLabel(new Date(2026, 10, 5, 9, 5).toISOString(), now)).toBe("11月5日 09:05");
    expect(isSameLocalDay(new Date(2026, 10, 6, 1, 0).toISOString(), now)).toBe(true);
    expect(isSameLocalDay(new Date(2026, 10, 5, 23, 0).toISOString(), now)).toBe(false);
    expect(isSameLocalDay(undefined, now)).toBe(false);
  });

  it("activeMention", () => {
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("hi @小码", 6)).toEqual({ start: 3, query: "小码" });
    expect(activeMention("a@b", 3)).toBeNull(); // 邮箱不算提及
    expect(activeMention("@小码 好", 5)).toBeNull();
  });
});

describe("serverClock", () => {
  it("按 serverTime 校正时钟偏差；小偏差视为延迟而忽略", () => {
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    useHub.setState((s) => ({ model: { ...s.model, serverTime: ahead } }));
    expect(Math.abs(serverNow() - (Date.now() + 3_600_000))).toBeLessThan(500);
    useHub.setState((s) => ({ model: { ...s.model, serverTime: new Date(Date.now() - 3_000).toISOString() } }));
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(500);
    useHub.setState((s) => ({ model: { ...s.model, serverTime: new Date(0).toISOString() } }));
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(500);
  });
});
