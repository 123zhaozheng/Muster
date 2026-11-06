import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { MAIN_THREAD_ID, type ModelSettings } from "@muster/protocol";
import { entriesByThread, snapshot } from "@muster/protocol/fixtures";
import { emptyModel, modelFromSnapshot } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { useHub } from "../../lib/hub";
import { useContextPanelStore } from "../../components/layout/contextPanelState";
import { setSendKey } from "../../lib/preferences";
import { useServerNow } from "../../components/home/serverClock";
import { clockLabel, greetingFor, nextDailyRun } from "../../components/home/time";
import HomePage from "./index";

const request = vi.fn();

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}<span data-testid="search">{loc.search}</span></div>;
}

function setup(opts: { withEntries?: boolean; modelSettings?: ModelSettings; url?: string } = {}) {
  const client = { request, onPush: () => () => {}, onStatus: () => () => {}, close() {} } as unknown as MusterClient;
  const model = {
    ...modelFromSnapshot(structuredClone(snapshot)),
    entries: opts.withEntries === false ? {} : structuredClone(entriesByThread),
    modelSettings: opts.modelSettings ?? {},
  };
  useHub.setState({ model, status: "open", client, loadedThreads: { [MAIN_THREAD_ID]: true } });
  return render(
    <MemoryRouter initialEntries={[opts.url ?? "/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const input = () => screen.getByLabelText("给 Pip 的消息") as HTMLTextAreaElement;
const panel = () => screen.getByRole("complementary", { name: "此刻" });
const section = (name: string) => within(panel()).getByRole("heading", { name }).closest("section")!;

beforeEach(() => {
  useContextPanelStore.setState({ pref: null, wide: true, drawerOpen: false });
  request.mockReset();
  request.mockResolvedValue({ entryId: "e-x" });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  useHub.setState({ model: emptyModel(), status: "connecting", client: null, loadedThreads: {} });
});

describe("主线页", () => {
  it("有消息时没有问候块和建议：计数只在头部状态胶囊里", () => {
    setup();
    expect(screen.queryByText(/今天想一起完成什么/)).toBeNull();
    expect(screen.queryByText("2 项进行中 · 1 项等你确认")).toBeNull();
    expect(screen.queryByRole("region", { name: "开始" })).toBeNull();
  });

  it("对话：用户与 Pip 的消息、选项", () => {
    setup();
    expect(screen.getByText(/shop-api 里两件事/)).toBeTruthy();
    expect(screen.getByText("好的，我来安排一下：")).toBeTruthy();
    expect(screen.getByRole("button", { name: "顺便跑测试" })).toBeTruthy();
  });

  it("派发显示为一个任务组：每个工单一行（状态、成员 · 标题），默认收起，点开才看真实摘要", () => {
    setup();
    const group = within(screen.getByRole("group", { name: "任务派发" }));
    const row = group.getByRole("button", { name: /小码 · 修支付回调 bug/ });
    expect(group.getByRole("button", { name: /阿克 · 写退款接口/ })).toBeTruthy();
    expect(group.getByRole("img", { name: "执行中" })).toBeTruthy();
    expect(group.getByRole("img", { name: "等你确认" })).toBeTruthy();
    expect(group.queryByText("12 通过 · 0 失败")).toBeNull();
    fireEvent.click(row);
    expect(group.getByText("12 通过 · 0 失败")).toBeTruthy(); // thread.lastText
    expect(group.queryByRole("progressbar")).toBeNull(); // task.progress 是猜测值，不画进度
    expect(group.queryByText(/%/)).toBeNull();
  });

  it("点开任务行后“查看详情”进入工单详情", () => {
    setup();
    const group = within(screen.getByRole("group", { name: "任务派发" }));
    fireEvent.click(group.getByRole("button", { name: /修支付回调 bug/ }));
    fireEvent.click(group.getByRole("link", { name: "查看详情：修支付回调 bug" }));
    expect(screen.getByTestId("where").textContent).toContain("/task/task-fix-callback");
  });

  it("对话里的待确认是一条琥珀提示行（在下方确认），收件箱链接是次要入口", () => {
    setup();
    act(() => useHub.setState((s) => ({
      model: { ...s.model, entries: { ...s.model.entries, [MAIN_THREAD_ID]: [...s.model.entries[MAIN_THREAD_ID]!, { id: "e-ap", threadId: MAIN_THREAD_ID, ts: new Date().toISOString(), kind: "approval", approvalId: "ap-1" }] } },
    })));
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    expect(screen.getByText(/· 在下方确认/)).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /在收件箱查看/ });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/inbox?id=ap-1");
  });

  it("点选项把文字填入输入框，可继续修改", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "顺便跑测试" }));
    expect(input().value).toBe("顺便跑测试");
    fireEvent.click(screen.getByRole("button", { name: "完成后通知我" }));
    expect(input().value).toBe("顺便跑测试，完成后通知我");
  });

  it("流式消息显示光标并渲染 Markdown", () => {
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

  it("Pip 的思考：流式时一行“思考中”（不再叠加思考提示），完成后折叠为“已思考 Xs”，点开看全文", () => {
    setup();
    const thinking = { id: "th1", threadId: MAIN_THREAD_ID, ts: new Date().toISOString(), kind: "thinking" as const, botId: "bot-pip", text: "用户想修回调，交给小码" };
    act(() => useHub.setState((s) => ({
      model: {
        ...s.model,
        bots: { ...s.model.bots, "bot-pip": { ...s.model.bots["bot-pip"]!, status: "thinking" } },
        entries: { ...s.model.entries, [MAIN_THREAD_ID]: [...(s.model.entries[MAIN_THREAD_ID] ?? []), { ...thinking, streaming: true }] },
      },
    })));
    expect(screen.getByRole("button", { name: /思考中/ })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "正在思考" })).toBeNull();
    act(() => useHub.setState((s) => ({
      model: { ...s.model, entries: { ...s.model.entries, [MAIN_THREAD_ID]: [...s.model.entries[MAIN_THREAD_ID]!.slice(0, -1), { ...thinking, streaming: false, durationMs: 3_200 }] } },
    })));
    const toggle = screen.getByRole("button", { name: /已思考 3s/ });
    expect(screen.queryByText("用户想修回调，交给小码")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("用户想修回调，交给小码")).toBeTruthy();
  });

  it("空主线：小 Pip + 一句问候 + 至多 4 个建议胶囊，点了只填入输入框不发送", () => {
    setup({ withEntries: false });
    const starters = screen.getByRole("region", { name: "开始" });
    expect(within(starters).getByText(/^(早上好|中午好|下午好|晚上好|夜深了)，有什么要交给团队的？$/)).toBeTruthy();
    const pills = within(starters).getAllByRole("button");
    expect(pills.length).toBeGreaterThan(0);
    expect(pills.length).toBeLessThanOrEqual(4);
    fireEvent.click(within(starters).getByRole("button", { name: "每日简报" }));
    expect(input().value).toMatch(/每天早上 9 点/);
    expect(request).not.toHaveBeenCalled();
  });

  it("未连接时显示加载占位而不是空态", () => {
    setup({ withEntries: false });
    act(() => useHub.setState({ status: "connecting" }));
    expect(screen.getByRole("status", { name: "正在连接守护进程" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "开始" })).toBeNull();
  });

  it("未配置模型时一行轻提示，链接到 设置 · 模型与连接", () => {
    setup();
    const hint = screen.getByRole("region", { name: "模型未配置" });
    fireEvent.click(within(hint).getByRole("link", { name: /设置 · 模型与连接/ }));
    expect(screen.getByTestId("where").textContent).toContain("/settings");
    expect(screen.getByTestId("search").textContent).toBe("?tab=models");
  });

  it("已配置 router 或 native 模型时不显示提示", () => {
    setup({ withEntries: false, modelSettings: { native: { provider: "deepseek", modelId: "deepseek-chat" } } });
    expect(screen.queryByRole("region", { name: "模型未配置" })).toBeNull();
    cleanup();
    setup({ modelSettings: { router: { provider: "deepseek", modelId: "deepseek-chat" } } });
    expect(screen.queryByRole("region", { name: "模型未配置" })).toBeNull();
  });
});

describe("头部", () => {
  it("没有“主线”大标题：左侧只有会话名 Pip，⌄ 菜单列出最近的成员对话", async () => {
    setup();
    expect(screen.queryByRole("heading", { name: "主线" })).toBeNull();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Pip");
    fireEvent.click(within(h1).getByRole("button", { name: "Pip" }));
    const menu = await screen.findByRole("dialog", { name: "最近的对话" });
    const links = within(menu).getAllByRole("link", { name: /小码 · 修支付回调 bug/ });
    expect(links.length).toBeGreaterThan(0);
    fireEvent.click(links.find((a) => a.getAttribute("href") === "/task/task-fix-callback")!);
    expect(screen.getByTestId("where").textContent).toContain("/task/task-fix-callback");
  });

  it("状态胶囊显示真实计数；右栏默认关闭，点胶囊打开", () => {
    setup();
    expect(screen.queryByRole("complementary", { name: "此刻" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 需要你 · 2 进行中" }));
    expect(screen.getByRole("complementary", { name: "此刻" })).toBeTruthy();
  });

  it("没有需要你和进行中的事时不显示状态胶囊", () => {
    setup();
    act(() => useHub.setState((s) => ({ model: { ...s.model, tasks: {}, approvals: {} } })));
    expect(screen.queryByRole("button", { name: /需要你|进行中/ })).toBeNull();
    expect(screen.getByRole("button", { name: "打开上下文" })).toBeTruthy();
  });
});

describe("右栏 此刻", () => {
  beforeEach(() => useContextPanelStore.setState({ pref: "open" }));

  it("需要你：审批只有一个入口，指向收件箱", () => {
    setup();
    const needs = section("需要你");
    const link = within(needs).getByRole("link", { name: /阿克 想运行 pnpm install/ });
    expect(link.getAttribute("href")).toBe("/inbox?id=ap-1");
    expect(within(needs).getAllByRole("link")).toHaveLength(1); // 等待中的任务不再单独列出
  });

  it("没有审批记录却在等确认的任务也出现在需要你", () => {
    setup();
    act(() => useHub.setState((s) => ({ model: { ...s.model, approvals: {} } })));
    const link = within(section("需要你")).getByRole("link", { name: /阿克 · 写退款接口/ });
    expect(link.getAttribute("href")).toBe("/task/task-refund-api");
  });

  it("进行中：只列执行中/排队的任务，不含等待确认的，只写阶段不写百分比", () => {
    setup();
    const active = section("进行中");
    expect(within(active).getByText("小码 · 修支付回调 bug")).toBeTruthy();
    expect(within(active).getAllByText("执行中").length).toBeGreaterThan(0);
    expect(within(active).queryByText(/%/)).toBeNull();
    expect(within(active).queryByText(/写退款接口/)).toBeNull();
  });

  it("接下来：cron 的下次运行带具体日期", () => {
    setup();
    const next = section("接下来");
    expect(within(next).getByText(/^(今天|明天) \d+月\d+日 09:00$/)).toBeTruthy();
    expect(within(next).getByText("每日 09:00 晨间简报")).toBeTruthy();
  });

  it("成员：每人一行（名字 + 状态），最多 3 行，其余“查看全部 N 项”去团队页", () => {
    setup();
    const members = section("成员");
    const links = within(members).getAllByRole("link");
    expect(links).toHaveLength(4); // 3 行 + 查看全部
    expect(within(members).queryByText("Pip")).toBeNull();
    const more = within(members).getByRole("link", { name: "查看全部 4 项" });
    expect(more.getAttribute("href")).toBe("/crew");
    for (const row of links.slice(0, 3)) {
      expect(row.getAttribute("href")).toBe("/crew");
      expect(row.textContent).toMatch(/^(小码|阿克|小探|小文)/);
    }
  });

  it("行内只有一行字，长说明放进 tooltip", () => {
    setup();
    const row = within(section("需要你")).getByRole("link", { name: /阿克 想运行 pnpm install/ });
    expect(row.getAttribute("title")).toBeTruthy();
    expect(row.querySelectorAll(".truncate")).toHaveLength(1);
  });

  it("没有数据的组不显示；全部为空时一句安静的话", () => {
    setup({ withEntries: false });
    act(() => useHub.setState((s) => ({ model: { ...s.model, tasks: {}, approvals: {}, triggers: {} } })));
    expect(within(panel()).queryByRole("heading", { name: "需要你" })).toBeNull();
    expect(within(panel()).queryByRole("heading", { name: "进行中" })).toBeNull();
    expect(within(panel()).queryByRole("heading", { name: "接下来" })).toBeNull();
    expect(within(panel()).getByRole("heading", { name: "成员" })).toBeTruthy();
    act(() => useHub.setState((s) => ({ model: { ...s.model, bots: { "bot-pip": s.model.bots["bot-pip"]! } } })));
    expect(within(panel()).getByText("此刻没有需要关注的事。")).toBeTruthy();
  });
});

describe("输入区", () => {
  it("Enter 发送并调用 chat.send；Shift+Enter 不发送", async () => {
    setup();
    fireEvent.change(input(), { target: { value: "你好 Pip" } });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(request).toHaveBeenCalledWith("chat.send", { threadId: MAIN_THREAD_ID, text: "你好 Pip" });
    await waitFor(() => expect(input().value).toBe(""));
  });

  it("输入法组字时 Enter 不发送", () => {
    setup();
    fireEvent.change(input(), { target: { value: "nihao" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    expect(request).not.toHaveBeenCalled();
    expect(input().value).toBe("nihao");
  });

  it("空输入时发送按钮不可用", () => {
    setup({ withEntries: false });
    act(() => useHub.setState((s) => ({ model: { ...s.model, tasks: {} } })));
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("发送失败时恢复草稿并提示", async () => {
    request.mockRejectedValueOnce(new Error("not connected"));
    setup();
    fireEvent.change(input(), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByText(/发送失败/)).toBeTruthy());
    expect(input().value).toBe("hi");
  });

  it("发送中按钮显示加载并禁用", async () => {
    let resolve!: (v: unknown) => void;
    request.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    setup();
    fireEvent.change(input(), { target: { value: "hi" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    const btn = (await screen.findByRole("button", { name: "发送" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    await act(async () => resolve({ entryId: "e" }));
    // 发完后输入为空、主线仍有任务在跑：主按钮换成“停止”，不再有加载中的按钮
    await waitFor(() => expect(document.querySelector("[aria-busy=\"true\"]")).toBeNull());
  });

  it("有主线派发的任务在运行且输入为空时，主按钮是“停止”并调用 task.interrupt", () => {
    setup();
    expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "停止 1 项进行中的任务" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("task.interrupt", { taskId: "task-fix-callback" });
  });

  it("开始输入后主按钮回到“发送”", () => {
    setup();
    fireEvent.change(input(), { target: { value: "补充一句" } });
    expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^停止/ })).toBeNull();
  });

  it("没有语音/附件这类未实现入口", () => {
    setup();
    expect(screen.queryByRole("button", { name: /语音|附件/ })).toBeNull();
  });

  it("输入 @ 弹出成员选择，选中后插入“交给<名字>”", () => {
    setup();
    fireEvent.change(input(), { target: { value: "@" } });
    const list = screen.getByRole("listbox", { name: "选择成员" });
    expect(within(list).getAllByRole("option")).toHaveLength(4); // Pip 自己不在列表里
    expect(within(list).queryByText("Pip")).toBeNull();
    fireEvent.change(input(), { target: { value: "@小" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(3); // 小码 小探 小文
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByText("小码"));
    expect(input().value).toBe("交给小码 ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("@ 菜单用键盘选择，Enter 选中而不发送；Esc 关闭", () => {
    setup();
    fireEvent.change(input(), { target: { value: "帮我 @阿" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(request).not.toHaveBeenCalled();
    expect(input().value).toBe("帮我 交给阿克 ");
    fireEvent.change(input(), { target: { value: "x @" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("@ 只在词首触发：邮箱里的 @ 不弹菜单，已完成的提及后继续输入也不弹", () => {
    setup();
    fireEvent.change(input(), { target: { value: "a@b" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(input(), { target: { value: "@小码 好" } });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("发送方式设为 Ctrl+Enter：Enter 换行不发送，Ctrl/⌘+Enter 发送，提示随之变化", async () => {
    setSendKey("ctrl-enter");
    setup();
    expect(screen.getByText(/换行/).textContent).not.toContain("Shift");
    fireEvent.change(input(), { target: { value: "第一行" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true, isComposing: true });
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true, keyCode: 229 });
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    expect(request).toHaveBeenCalledWith("chat.send", { threadId: MAIN_THREAD_ID, text: "第一行" });
    await waitFor(() => expect(input().value).toBe(""));
  });

  it("设置里切换发送方式后输入框立即生效", () => {
    setup();
    fireEvent.change(input(), { target: { value: "hi" } });
    act(() => setSendKey("ctrl-enter"));
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(request).not.toHaveBeenCalled();
    act(() => setSendKey("enter"));
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(request).toHaveBeenCalledWith("chat.send", { threadId: MAIN_THREAD_ID, text: "hi" });
  });

  it("左侧“+”（指派给成员）在光标处插入 @ 并弹出成员选择", () => {
    setup();
    fireEvent.change(input(), { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "指派给成员" }));
    expect(input().value).toBe("你好 @");
    expect(screen.getByRole("listbox", { name: "选择成员" })).toBeTruthy();
  });

  it("选中成员后，输入框下方出现真实的“交给 <成员>” chip", () => {
    setup();
    expect(screen.queryByLabelText("交给")).toBeNull();
    fireEvent.change(input(), { target: { value: "@小码" } });
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByText("小码"));
    expect(screen.getByLabelText("交给").textContent).toContain("交给 小码");
  });

  it("待确认的审批停靠在输入框正上方：批准一次 / 拒绝，不弹窗", () => {
    setup();
    const dock = screen.getByRole("region", { name: "待你确认" });
    expect(within(dock).getByText("阿克 想运行 pnpm install")).toBeTruthy();
    expect(within(dock).getByText("pnpm install --frozen-lockfile")).toBeTruthy();
    expect(dock.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(dock).getByRole("button", { name: "批准一次" }));
    expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-1", decision: "allow" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("滚动回看", () => {
  function scrollAway() {
    const el = screen.getByText("好的，我来安排一下：").closest<HTMLElement>(".overflow-y-auto")!;
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 600 });
    el.scrollTop = 0;
    fireEvent.scroll(el);
    return el;
  }

  it("滚离底部后来了新消息，出现“有新消息”，点击回到最新", () => {
    setup();
    scrollAway();
    expect(screen.getByRole("button", { name: "回到最新" })).toBeTruthy();
    act(() => useHub.setState((s) => ({
      model: { ...s.model, entries: { ...s.model.entries, [MAIN_THREAD_ID]: [...s.model.entries[MAIN_THREAD_ID]!, { id: "e-new", threadId: MAIN_THREAD_ID, ts: new Date().toISOString(), kind: "bot", botId: "bot-pip", text: "新进展" }] } },
    })));
    fireEvent.click(screen.getByRole("button", { name: "有新消息" }));
    expect(screen.queryByRole("button", { name: "有新消息" })).toBeNull();
  });
});

describe("从全局搜索跳转", () => {
  it("?msg=<entryId> 滚动到对应消息", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    setup({ url: "/?msg=e-m-2" });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("msg-e-m-2"));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe("工具函数", () => {
  it("greetingFor", () => {
    expect([8, 12, 15, 20, 2].map(greetingFor)).toEqual(["早上好", "中午好", "下午好", "晚上好", "夜深了"]);
  });

  it("nextDailyRun：带具体日期，跨月，其它 cron 不猜", () => {
    const now = Date.parse("2026-11-06T02:00:00Z"); // 上海 10:00
    expect(nextDailyRun("0 9 * * *", "Asia/Shanghai", now)).toEqual({ label: "明天 11月7日 09:00", order: 1440 + 540 });
    expect(nextDailyRun("30 18 * * *", "Asia/Shanghai", now)).toEqual({ label: "今天 11月6日 18:30", order: 1110 });
    expect(nextDailyRun("0 9 * * *", "Asia/Shanghai", Date.parse("2026-11-30T02:00:00Z"))?.label).toBe("明天 12月1日 09:00");
    expect(nextDailyRun("0 9 * * *", "Asia/Shanghai", Date.parse("2026-11-30T17:00:00Z"))?.label).toBe("今天 12月1日 09:00"); // 上海已是 12 月 1 日 01:00
    expect(nextDailyRun("*/5 * * * *", "Asia/Shanghai", now)).toBeNull();
  });

  it("clockLabel", () => {
    const now = new Date(2026, 10, 6, 15, 0).getTime();
    expect(clockLabel(new Date(2026, 10, 6, 9, 5).toISOString(), now)).toBe("09:05");
    expect(clockLabel(new Date(2026, 10, 5, 9, 5).toISOString(), now)).toBe("11月5日 09:05");
  });

  it("serverClock：按 serverTime 校正时钟偏差；小偏差视为延迟而忽略", () => {
    const now = () => renderHook(() => useServerNow(0)).result.current;
    useHub.setState((s) => ({ model: { ...s.model, serverTime: new Date(Date.now() + 3_600_000).toISOString() } }));
    expect(Math.abs(now() - (Date.now() + 3_600_000))).toBeLessThan(500);
    useHub.setState((s) => ({ model: { ...s.model, serverTime: new Date(Date.now() - 3_000).toISOString() } }));
    expect(Math.abs(now() - Date.now())).toBeLessThan(500);
    useHub.setState((s) => ({ model: { ...s.model, serverTime: new Date(0).toISOString() } }));
    expect(Math.abs(now() - Date.now())).toBeLessThan(500);
  });
});
