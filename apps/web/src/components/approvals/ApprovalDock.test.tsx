import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Approval } from "@muster/protocol";
import { snapshot } from "@muster/protocol/fixtures";
import { emptyModel, modelFromSnapshot } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { useHub } from "../../lib/hub";
import { ApprovalDock, RESOLVED_LINGER_MS } from "./ApprovalDock";

const request = vi.fn();

const ap = (patch: Partial<Approval> & Pick<Approval, "id">): Approval => ({
  botId: "bot-xiaoma", taskId: "task-fix-callback", title: "小码 想运行 pnpm test", detail: "pnpm test --run", risk: "low", status: "pending", createdAt: "2026-11-06T08:00:00.000Z", ...patch,
});

function setup(approvals: Approval[], taskId?: string) {
  const client = { request, onPush: () => () => {}, onStatus: () => () => {}, close() {} } as unknown as MusterClient;
  const model = { ...modelFromSnapshot(structuredClone(snapshot)), approvals: Object.fromEntries(approvals.map((a) => [a.id, a])) };
  useHub.setState({ model, status: "open", client });
  return render(
    <MemoryRouter>
      <ApprovalDock taskId={taskId} />
    </MemoryRouter>,
  );
}

const patch = (id: string, change: Partial<Approval>) =>
  act(() => useHub.setState((s) => ({ model: { ...s.model, approvals: { ...s.model.approvals, [id]: { ...s.model.approvals[id]!, ...change } } } })));

const dock = () => screen.getByRole("region", { name: "待你确认" });

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useHub.setState({ model: emptyModel(), status: "connecting", client: null });
});

describe("审批停靠条", () => {
  it("没有待确认时不渲染", () => {
    setup([ap({ id: "a", status: "allowed" })]);
    expect(screen.queryByRole("region", { name: "待你确认" })).toBeNull();
  });

  it("主线：显示全部待确认，一次一条，最早的在前，用 1/2 切换", () => {
    setup([
      ap({ id: "b", taskId: "task-refund-api", botId: "bot-ake", title: "阿克 想运行 pnpm install", detail: "pnpm install", createdAt: "2026-11-06T09:00:00.000Z" }),
      ap({ id: "a" }),
    ]);
    expect(within(dock()).getByText("小码 想运行 pnpm test")).toBeTruthy();
    expect(within(dock()).queryByText("阿克 想运行 pnpm install")).toBeNull();
    expect(within(dock()).getByText("1/2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(within(dock()).getByText("阿克 想运行 pnpm install")).toBeTruthy();
    expect(within(dock()).getByText("2/2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(within(dock()).getByText("1/2")).toBeTruthy();
  });

  it("工单详情：只显示该工单的请求", () => {
    setup([ap({ id: "a" }), ap({ id: "b", taskId: "task-refund-api", title: "阿克 想运行 pnpm install" })], "task-refund-api");
    expect(within(dock()).getByText("阿克 想运行 pnpm install")).toBeTruthy();
    expect(within(dock()).queryByText("小码 想运行 pnpm test")).toBeNull();
    expect(screen.queryByRole("button", { name: "下一条" })).toBeNull();
  });

  it("只有“批准一次 / 拒绝”两个决定，没有“总是允许”", () => {
    setup([ap({ id: "a" })]);
    const names = within(dock()).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toContain("批准一次");
    expect(names).toContain("拒绝");
    expect(names.some((n) => /总是|都允许|始终/.test(n ?? ""))).toBe(false);
    expect(within(dock()).getByRole("link", { name: "详情" }).getAttribute("href")).toBe("/inbox?id=a");
  });

  it("批准一次传 allow；提交中两个按钮都禁用", async () => {
    let resolve!: (v: unknown) => void;
    request.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    setup([ap({ id: "a" })]);
    fireEvent.click(screen.getByRole("button", { name: "批准一次" }));
    expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "a", decision: "allow" });
    expect((screen.getByRole("button", { name: "批准一次" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "拒绝" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ ok: true }));
    expect(screen.getByText(/已提交，等待同步结果/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "批准一次" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("拒绝传 deny；失败时就地提示并可重试", async () => {
    request.mockRejectedValueOnce(new Error("conflict"));
    setup([ap({ id: "a" })]);
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "a", decision: "deny" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("操作失败：conflict"));
    expect((screen.getByRole("button", { name: "拒绝" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("高风险：第一次点击只要求确认，第二次才批准；不弹窗", () => {
    setup([ap({ id: "a", risk: "high", title: "小码 想运行 rm -rf dist", detail: "rm -rf dist" })]);
    expect(within(dock()).getByText("高风险")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "批准一次" }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认批准" }));
    expect(request).toHaveBeenCalledWith("approval.resolve", { approvalId: "a", decision: "allow" });
  });

  it("命令等宽截断，点开看全文", () => {
    setup([ap({ id: "a" })]);
    const cmd = within(dock()).getByRole("button", { name: "pnpm test --run" });
    expect(cmd.className).toContain("font-mono");
    expect(cmd.className).toContain("truncate");
    fireEvent.click(cmd);
    expect(cmd.getAttribute("aria-expanded")).toBe("true");
    expect(cmd.className).not.toContain("truncate");
  });

  it("在别处处理或过期后显示结果，可手动收起，否则过一会儿自动收起", () => {
    vi.useFakeTimers();
    setup([ap({ id: "a" }), ap({ id: "b", title: "小码 想运行 ls" })]);
    patch("a", { status: "expired", resolvedAt: "2026-11-06T08:05:00.000Z" });
    expect(within(dock()).getByRole("status").textContent).toContain("已过期");
    expect(screen.queryByRole("button", { name: "批准一次" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(within(dock()).getByText("小码 想运行 ls")).toBeTruthy();
    patch("b", { status: "allowed", resolvedAt: "2026-11-06T08:06:00.000Z" });
    expect(within(dock()).getByRole("status").textContent).toContain("已允许");
    act(() => vi.advanceTimersByTime(RESOLVED_LINGER_MS));
    expect(screen.queryByRole("region", { name: "待你确认" })).toBeNull();
  });
});
