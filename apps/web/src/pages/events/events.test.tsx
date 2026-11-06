import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { events as fixtureEvents, triggers as fixtureTriggers } from "@muster/protocol/fixtures";
import type { HubEvent } from "@muster/protocol";
import { useHub } from "../../lib/hub";
import { setupHub } from "../../components/events/testHarness";
import EventsPage from "./index";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(cleanup);

const handlers = {
  "event.list": (p: { source?: string }) => ({ events: fixtureEvents.filter((e) => !p.source || e.source === p.source) }),
  "trigger.upsert": (p: { trigger: Record<string, unknown> }) => ({ trigger: { id: "tr-new", ...p.trigger } as never }),
  "trigger.delete": () => ({ ok: true as const }),
  "trigger.fire": () => ({ eventId: "ev-fired" }),
};

const eventItems = () => screen.queryAllByTestId("event-item");
const renderPage = () =>
  render(
    <MemoryRouter>
      <EventsPage />
    </MemoryRouter>,
  );
const showSchedule = () => fireEvent.mouseDown(screen.getByRole("tab", { name: "日程" }), { button: 0 });
const openRule = (label: string) => {
  showSchedule();
  fireEvent.click(screen.getByRole("button", { name: `编辑日程 ${label}` }));
};

describe("EventsPage feed", () => {
  it("shows the 动态 tab first with events grouped by day, source, member, status and links", async () => {
    setupHub(handlers);
    renderPage();
    await act(async () => undefined);
    expect(screen.getByRole("heading", { name: "事件" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "动态" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("event-day").length).toBeGreaterThan(0);
    expect(eventItems()).toHaveLength(fixtureEvents.length);

    const pr = eventItems().find((i) => i.textContent?.includes("PR #128"))!;
    expect(within(pr).getByText("GitHub")).toBeTruthy();
    expect(within(pr).getByText("阿克")).toBeTruthy();
    expect(within(pr).getByText("已记录")).toBeTruthy();
    expect(within(pr).getByText("观察模式：已记录将会做什么")).toBeTruthy();
    expect(within(pr).getByRole("link", { name: "继续对话" }).getAttribute("href")).toBe("/task/task-refund-api");

    const callback = eventItems().find((i) => i.textContent?.includes("完成了 修支付回调"))!;
    expect(within(callback).getByRole("link", { name: "来源任务：修支付回调 bug" }).getAttribute("href")).toBe("/task/task-fix-callback");
    expect(within(callback).getByRole("link", { name: "继续对话" }).getAttribute("href")).toBe("/task/task-fix-callback");

    const device = eventItems().find((i) => i.textContent?.includes("书房台式机 上线"))!;
    expect(within(device).queryByRole("link", { name: "继续对话" })).toBeNull();
  });

  it("folds a burst of look-alike events into one row that expands", async () => {
    setupHub({ ...handlers, "event.list": () => ({ events: [] }) });
    const burst: HubEvent[] = ["a", "b", "c", "d"].map((id, i) => ({
      id: `burst-${id}`,
      ts: new Date(Date.now() - i * 1000).toISOString(),
      source: "cron",
      title: "定时 · 巡检",
      triggerId: "tr-brief",
      status: i === 0 ? "failed" : "delivered",
    }));
    useHub.setState((s) => ({ model: { ...s.model, events: burst } }));
    renderPage();
    await act(async () => undefined);
    const run = screen.getByTestId("event-run");
    expect(within(run).getByText("共 4 次")).toBeTruthy();
    expect(within(run).getByText("1 次失败")).toBeTruthy();
    const before = eventItems().length;
    fireEvent.click(within(run).getByRole("button", { name: "展开全部" }));
    expect(eventItems().length).toBe(before + 4);
  });

  it("filters by source and merges live pushes", async () => {
    const request = setupHub(handlers);
    renderPage();
    const trigger = screen.getByRole("combobox", { name: "按来源筛选" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(await screen.findByRole("option", { name: "GitHub" }), { key: "Enter" });
    await waitFor(() => expect(request).toHaveBeenCalledWith("event.list", { source: "github", limit: 100 }));
    await waitFor(() => expect(eventItems()).toHaveLength(1));

    const ts = "2099-01-01T00:00:00.000Z";
    const live: HubEvent = { id: "ev-live", ts, source: "github", title: "GitHub · PR #129 已打开 · shop-api", status: "recorded" };
    const other: HubEvent = { id: "ev-live-2", ts, source: "cron", title: "定时 · 实时事件" };
    act(() => {
      useHub.setState((s) => ({ model: { ...s.model, events: [live, other, ...s.model.events] } }));
    });
    expect(eventItems()).toHaveLength(2);
    expect(eventItems()[0]!.textContent).toContain("PR #129"); // newest first
    expect(screen.queryByText("定时 · 实时事件")).toBeNull();
  });

  it("shows an empty state without events", async () => {
    setupHub({ ...handlers, "event.list": () => ({ events: [] }) });
    useHub.setState((s) => ({ model: { ...s.model, events: [] } }));
    renderPage();
    await act(async () => undefined);
    expect(screen.getByText("还没有事件")).toBeTruthy();
  });
});

describe("EventsPage schedule", () => {
  it("lists rules with plain-language frequency, dated next run with time zone, and last result", async () => {
    setupHub(handlers);
    renderPage();
    await act(async () => undefined);
    showSchedule();
    const rows = screen.getAllByTestId("schedule-row");
    expect(rows).toHaveLength(fixtureTriggers.length);
    const brief = rows.find((r) => r.textContent?.includes("每日 09:00 晨间简报"))!;
    expect(within(brief).getByText(/定时 · 每天 09:00/)).toBeTruthy();
    expect(within(brief).getByText(/^\d+月\d+日 周. 09:00$/)).toBeTruthy();
    expect(within(brief).getByText("Asia/Shanghai")).toBeTruthy();
    expect(within(brief).getByText(/已送达/)).toBeTruthy();
    const pr = rows.find((r) => r.textContent?.includes("当 PR 打开时"))!;
    expect(within(pr).getByText("有事件时触发")).toBeTruthy();
    expect(within(pr).getByText(/shop-api · PR 打开/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "启用 当 PR 打开时" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows upcoming timed runs beside the tabs", async () => {
    setupHub(handlers);
    renderPage();
    const items = screen.getAllByTestId("upcoming-item");
    expect(items).toHaveLength(1); // only the enabled cron rule is timed
    expect(items[0]!.textContent).toContain("每日 09:00 晨间简报");
    expect(items[0]!.textContent).toContain("Asia/Shanghai");
  });

  it("toggles a rule without opening the editor", async () => {
    const request = setupHub(handlers);
    renderPage();
    showSchedule();
    fireEvent.click(screen.getByRole("switch", { name: "启用 每日 09:00 晨间简报" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("trigger.upsert", { trigger: { ...fixtureTriggers[1], enabled: false } }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("edits a rule in the drawer and saves it through trigger.upsert", async () => {
    const request = setupHub(handlers);
    renderPage();
    openRule("当 PR 打开时");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText(/^名称/) as HTMLInputElement).value).toBe("当 PR 打开时");
    fireEvent.click(screen.getByRole("radio", { name: "自动" }));
    expect(screen.getByTestId("mode-detail").textContent).toContain("直接交给成员执行");
    fireEvent.change(screen.getByLabelText("每日预算"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("switch", { name: "无人值守时自动拒绝审批" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("trigger.upsert", expect.anything()));
    expect(request).toHaveBeenCalledWith("trigger.upsert", {
      trigger: { ...fixtureTriggers[0], mode: "auto", dailyBudget: 20, autoDenyApprovalsWhenUnattended: false },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("creates a new cron rule (preset + dated preview) without an id", async () => {
    const request = setupHub(handlers);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "新建日程" }));
    fireEvent.change(await screen.findByLabelText(/^名称/), { target: { value: "每周一复盘" } });
    fireEvent.click(screen.getByRole("button", { name: "每周一 10 点" }));
    expect((screen.getByLabelText(/^Cron 表达式/) as HTMLInputElement).value).toBe("0 10 * * 1");
    const preview = within(screen.getByTestId("cron-preview")).getAllByRole("listitem");
    expect(preview).toHaveLength(3);
    expect(preview[0]!.textContent).toMatch(/^\d+月\d+日 周一 10:00$/);
    fireEvent.click(screen.getByRole("radio", { name: "询问" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("trigger.upsert", expect.anything()));
    const sent = request.mock.calls.find((c) => c[0] === "trigger.upsert")![1] as { trigger: Record<string, unknown> };
    expect(sent.trigger).toEqual({
      label: "每周一复盘",
      source: "cron",
      params: { expr: "0 10 * * 1", tz: "Asia/Shanghai" },
      targetBotId: "bot-xiaoma", // first non-main member is the default
      mode: "ask",
      enabled: true,
      dailyBudget: 10,
      autoDenyApprovalsWhenUnattended: true,
    });
    expect("id" in sent.trigger).toBe(false);
  });

  it("validates before saving and flags a bad cron expression", async () => {
    const request = setupHub(handlers);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "新建日程" }));
    await screen.findByLabelText(/^名称/);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("给日程起个名字吧")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "GitHub" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("请填写要监听的仓库")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: "坏规则" } });
    fireEvent.click(screen.getByRole("radio", { name: "定时" }));
    fireEvent.change(screen.getByLabelText(/^Cron 表达式/), { target: { value: "not a cron" } });
    expect(screen.getByLabelText(/^Cron 表达式/).getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(request).not.toHaveBeenCalledWith("trigger.upsert", expect.anything());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("dry-runs from the drawer; deleting asks for confirmation", async () => {
    const request = setupHub(handlers);
    renderPage();
    openRule("当 PR 打开时");
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "试跑" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("trigger.fire", { triggerId: "tr-pr" }));

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(request).not.toHaveBeenCalledWith("trigger.delete", expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("trigger.delete", { triggerId: "tr-pr" }));
  });

  it("new rules have no dry-run or delete", async () => {
    setupHub(handlers);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "新建日程" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "试跑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("shows an empty state when there are no rules", async () => {
    setupHub(handlers);
    useHub.setState((s) => ({ model: { ...s.model, triggers: {} } }));
    renderPage();
    showSchedule();
    expect(screen.getByText("还没有日程")).toBeTruthy();
    expect(screen.getByText("没有已启用的定时日程。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建第一条日程" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
