import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { setupHub } from "../../components/settings/testSetup";
import { useHub } from "../../lib/hub";
import Inbox from "./index";

describe("收件箱", () => {
  let request: ReturnType<typeof setupHub>;
  beforeEach(() => { request = setupHub(); });
  afterEach(cleanup);

  it("渲染待处理审批，允许按钮调用 approval.resolve", async () => {
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    expect(screen.getByText("阿克 想运行 pnpm install")).toBeTruthy();
    fireEvent.click(screen.getByText("允许"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-1", decision: "allow" }));
  });

  it("拒绝传 deny；按 Bot 筛选后无关审批消失", async () => {
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(screen.getByText("拒绝"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-1", decision: "deny" }));
    fireEvent.click(screen.getByRole("button", { name: /小码/ }));
    expect(screen.queryByText("阿克 想运行 pnpm install")).toBeNull();
    expect(screen.getByText("没有待处理的审批")).toBeTruthy();
  });

  it("已处理默认折叠，点击后展开", () => {
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    const toggle = screen.getByRole("button", { name: /已处理/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("「总是允许」带 remember 参数", async () => {
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(screen.getByText("总是允许"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-1", decision: "allow", remember: true }));
  });

  it("显示概览统计与命令预览", () => {
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    expect(screen.getByText("pnpm install --frozen-lockfile")).toBeTruthy();
    expect(screen.getAllByText("中风险").length).toBeGreaterThan(0);
    expect(screen.getByText("今天已处理")).toBeTruthy();
  });

  it("按风险筛选", () => {
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "高风险" }));
    expect(screen.queryByText("阿克 想运行 pnpm install")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "中风险" }));
    expect(screen.getByText("阿克 想运行 pnpm install")).toBeTruthy();
  });

  it("高风险审批：允许前要二次确认，且没有「总是允许」", async () => {
    act(() => {
      useHub.setState((s) => ({ model: { ...s.model, approvals: { ...s.model.approvals, "ap-1": { ...s.model.approvals["ap-1"]!, risk: "high" } } } }));
    });
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    expect(screen.queryByText("总是允许")).toBeNull();
    fireEvent.click(screen.getByText("允许"));
    expect(request).not.toHaveBeenCalledWith("approval.resolve", expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "仍然允许" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "ap-1", decision: "allow" }));
  });

  it("全部处理完后显示插画空态", () => {
    act(() => {
      useHub.setState((s) => ({ model: { ...s.model, approvals: { "ap-1": { ...s.model.approvals["ap-1"]!, status: "allowed", resolvedAt: new Date().toISOString() } } } }));
    });
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    expect(screen.getByText("都处理完了，Pip 很满意")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /已处理/ }));
    expect(screen.getByText("已允许")).toBeTruthy();
  });
});
