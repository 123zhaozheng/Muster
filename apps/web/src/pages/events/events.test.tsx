import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { events as fixtureEvents, triggers as fixtureTriggers } from "@muster/protocol/fixtures";
import type { HubEvent } from "@muster/protocol";
import { useHub } from "../../lib/hub";
import { setupHub } from "../../components/events/testHarness";
import EventsPage from "./index";

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
const openRule = (label: string) => fireEvent.click(screen.getByRole("button", { name: `编辑规则 ${label}` }));

describe("EventsPage", () => {
  it("renders header, stats, grouped timeline, filters and rule cards", async () => {
    setupHub(handlers);
    renderPage();
    await act(async () => undefined); // let the initial event.list settle
    expect(screen.getByRole("heading", { name: "事件" })).toBeTruthy();
    expect(screen.getByText("一切皆为事件，Muster 与你同行")).toBeTruthy();
    expect(screen.getByTestId("event-stats")).toBeTruthy();
    expect(screen.getByTestId("source-mix")).toBeTruthy();
    for (const name of ["全部", "用户", "定时", "GitHub", "回调", "设备"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getAllByTestId("event-day").length).toBeGreaterThan(0);
    expect(eventItems()).toHaveLength(fixtureEvents.length);
    expect(screen.getByText("GitHub · PR #128 已打开 · shop-api")).toBeTruthy();
    expect(screen.getByText("观察模式：已记录将会做什么")).toBeTruthy();
    expect(screen.getAllByText("已送达")).toHaveLength(2);
    // rule cards
    expect(screen.getAllByTestId("trigger-card")).toHaveLength(fixtureTriggers.length);
    for (const t of fixtureTriggers) expect(screen.getByRole("button", { name: `编辑规则 ${t.label}` })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "启用 当 PR 打开时" }).getAttribute("aria-checked")).toBe("true");
    // the editor is closed until asked for
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filters by source, merges live pushes and highlights the new ones", async () => {
    const request = setupHub(handlers);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("event.list", { source: "github", limit: 100 }));
    await waitFor(() => expect(eventItems()).toHaveLength(1));
    expect(within(eventItems()[0]!).getByText(/PR #128/)).toBeTruthy();

    const ts = "2099-01-01T00:00:00.000Z"; // newer than any fixture
    const live: HubEvent = { id: "ev-live", ts, source: "github", title: "GitHub · PR #129 已打开 · shop-api", status: "recorded" };
    const other: HubEvent = { id: "ev-live-2", ts, source: "cron", title: "定时 · 实时事件" };
    act(() => {
      useHub.setState((s) => ({ model: { ...s.model, events: [live, other, ...s.model.events] } }));
    });
    expect(eventItems()).toHaveLength(2);
    expect(eventItems()[0]!.textContent).toContain("PR #129"); // newest first
    expect(eventItems()[0]!.getAttribute("data-fresh")).toBe("true");
    expect(eventItems()[1]!.getAttribute("data-fresh")).toBeNull();
    expect(screen.queryByText("定时 · 实时事件")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    await waitFor(() => expect(eventItems()).toHaveLength(fixtureEvents.length + 2));
  });

  it("expands an event to show its details", async () => {
    setupHub(handlers);
    renderPage();
    await act(async () => undefined);
    const item = eventItems().find((i) => i.textContent?.includes("PR #128"))!;
    const toggle = within(item).getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await within(item).findByText("事件 ID")).toBeTruthy();
    expect(within(item).getByText("ev-1")).toBeTruthy();
    expect(within(item).getByText("当 PR 打开时")).toBeTruthy();
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

  it("creates a new cron rule (preset + preview) without an id", async () => {
    const request = setupHub(handlers);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "新建规则" }));
    fireEvent.change(await screen.findByLabelText(/^名称/), { target: { value: "每周一复盘" } });
    fireEvent.click(screen.getByRole("radio", { name: "定时" }));
    fireEvent.click(screen.getByRole("button", { name: "每周一 10 点" }));
    expect((screen.getByLabelText(/^Cron 表达式/) as HTMLInputElement).value).toBe("0 10 * * 1");
    expect(within(screen.getByTestId("cron-preview")).getAllByRole("listitem")).toHaveLength(3);
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
    fireEvent.click(screen.getByRole("button", { name: "新建规则" }));
    await screen.findByLabelText(/^名称/);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("给规则起个名字吧")).toBeTruthy();
    expect(screen.getByText("请填写要监听的仓库")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: "坏规则" } });
    fireEvent.click(screen.getByRole("radio", { name: "定时" }));
    fireEvent.change(screen.getByLabelText(/^Cron 表达式/), { target: { value: "not a cron" } });
    expect(screen.getByLabelText(/^Cron 表达式/).getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(request).not.toHaveBeenCalledWith("trigger.upsert", expect.anything());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("dry-runs from a card and from the drawer; deleting asks for confirmation", async () => {
    const request = setupHub(handlers);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "试跑 每日 09:00 晨间简报" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("trigger.fire", { triggerId: "tr-brief" }));

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
    fireEvent.click(screen.getByRole("button", { name: "新建规则" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "试跑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("toggles a rule from its card", async () => {
    const request = setupHub(handlers);
    renderPage();
    fireEvent.click(screen.getByRole("switch", { name: "启用 每日 09:00 晨间简报" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("trigger.upsert", { trigger: { ...fixtureTriggers[1], enabled: false } }));
    expect(screen.queryByRole("dialog")).toBeNull(); // the switch must not open the editor
  });

  it("shows an illustrated empty state when there are no rules", async () => {
    setupHub(handlers);
    useHub.setState((s) => ({ model: { ...s.model, triggers: {} } }));
    renderPage();
    expect(screen.getByText("还没有触发规则")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建第一条规则" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
