import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Approval } from "@muster/protocol";
import { setupHub } from "../../components/settings/testSetup";
import { useHub } from "../../lib/hub";
import Inbox from "./index";

const ap = (patch: Partial<Approval> & { id: string }): Approval => ({
  botId: "bot-xiaoma", title: "小码 想运行 rm -rf dist", detail: "rm -rf dist", risk: "high", status: "pending", createdAt: new Date().toISOString(), ...patch,
});

const addApprovals = (...list: Approval[]) =>
  act(() => {
    useHub.setState((s) => ({ model: { ...s.model, approvals: { ...s.model.approvals, ...Object.fromEntries(list.map((a) => [a.id, a])) } } }));
  });

const renderInbox = (url = "/inbox") => render(<MemoryRouter initialEntries={[url]}><Inbox /></MemoryRouter>);

describe("需要你", () => {
  let request: ReturnType<typeof setupHub>;
  beforeEach(() => { request = setupHub(); });
  afterEach(cleanup);

  it("默认展示第一条待处理审批：请求者、任务、命令原文、工作目录、风险", () => {
    renderInbox();
    const detail = screen.getByRole("article", { name: "审批详情" });
    expect(within(detail).getByText("阿克 想运行 pnpm install")).toBeTruthy();
    expect(within(detail).getByText("pnpm install --frozen-lockfile")).toBeTruthy();
    expect(within(detail).getByRole("link", { name: "写退款接口" }).getAttribute("href")).toBe("/task/task-refund-api");
    expect(within(detail).getByText("D:/work/shop-api")).toBeTruthy();
    expect(within(detail).getByText("中风险 · 会改动本机文件或安装依赖")).toBeTruthy();
  });

  it("不提供「总是允许」；「仅允许这一次」调用 approval.resolve 且不带 remember", async () => {
    renderInbox();
    expect(screen.queryByText("总是允许")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "仅允许这一次" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-1", decision: "allow" }));
  });

  it("拒绝传 deny；处理中按钮禁用", async () => {
    let finish: (v: unknown) => void = () => undefined;
    request.mockImplementation(() => new Promise((r) => { finish = r; }));
    renderInbox();
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-1", decision: "deny" }));
    expect((screen.getByRole("button", { name: "仅允许这一次" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish({}); });
    expect((screen.getByRole("button", { name: "拒绝" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("?id= 直达指定审批", () => {
    addApprovals(ap({ id: "ap-2" }));
    renderInbox("/inbox?id=ap-2");
    const detail = screen.getByRole("article", { name: "审批详情" });
    expect(within(detail).getByText("小码 想运行 rm -rf dist")).toBeTruthy();
    expect(within(detail).getByText("高风险")).toBeTruthy();
  });

  it("高风险审批：允许前要二次确认", async () => {
    addApprovals(ap({ id: "ap-2" }));
    renderInbox("/inbox?id=ap-2");
    fireEvent.click(screen.getByRole("button", { name: "仅允许这一次" }));
    expect(request).not.toHaveBeenCalledWith("approval.resolve", expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "仍然允许" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-2", decision: "allow" }));
  });

  it("已处理页签列出结果；已处理审批没有操作按钮并显示结果", () => {
    addApprovals(ap({ id: "ap-3", title: "小码 想运行 ls", risk: "low", status: "denied", resolvedAt: new Date().toISOString() }));
    renderInbox();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /已处理/ }), { button: 0 });
    fireEvent.click(screen.getByRole("link", { name: /小码 想运行 ls/ }));
    expect(screen.getByRole("status").textContent).toContain("已拒绝");
    expect(screen.queryByRole("button", { name: "拒绝" })).toBeNull();
  });

  it("过期的审批深链接显示已过期", () => {
    addApprovals(ap({ id: "ap-4", status: "expired", resolvedAt: new Date().toISOString() }));
    renderInbox("/inbox?id=ap-4");
    expect(screen.getByRole("status").textContent).toContain("已过期");
  });

  it("不存在的 id 显示找不到", () => {
    renderInbox("/inbox?id=nope");
    expect(screen.getByText("找不到这条审批")).toBeTruthy();
  });

  it("没有待处理时显示空态", () => {
    act(() => {
      useHub.setState((s) => ({ model: { ...s.model, approvals: {} } }));
    });
    renderInbox();
    expect(screen.getAllByText("没有等你确认的事").length).toBeGreaterThan(0);
  });
});
