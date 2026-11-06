import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setupHub } from "../../components/settings/testSetup";
import Costs from "./index";

describe("成本与审计", () => {
  beforeEach(() => { setupHub(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("显示合计、任务表与审计日志", () => {
    render(<Costs />);
    // 2.18 + 1.24 + 1.87 + 0.72 + 0.96
    expect(screen.getByText("$6.97")).toBeTruthy();
    expect(screen.getAllByText("修支付回调 bug").length).toBeGreaterThan(0);
    expect(screen.getByText("GitHub · PR #128 已打开 · shop-api")).toBeTruthy();
  });

  it("按来源筛选审计日志", () => {
    render(<Costs />);
    fireEvent.click(screen.getByRole("button", { name: "定时" }));
    expect(screen.queryByText("GitHub · PR #128 已打开 · shop-api")).toBeNull();
    expect(screen.getByText("定时 · 每日 09:00 晨间简报 · 已送达")).toBeTruthy();
  });

  it("导出 JSON 会生成下载", () => {
    const create = vi.fn(() => "blob:test");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<Costs />);
    fireEvent.click(screen.getByRole("button", { name: "导出 JSON" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });

  it("概览：Token 总量、任务数与平均每任务", () => {
    render(<Costs />);
    expect(screen.getByText("本周总花费")).toBeTruthy();
    expect(screen.getByText("Token 总量")).toBeTruthy();
    expect(screen.getByText("平均每任务")).toBeTruthy();
    // 0.41 + 0.56 over the two tasks that report a cost
    expect(screen.getByText(/^\$0\.4[89]$/)).toBeTruthy();
  });

  it("按 Bot 花费条形图按金额降序", () => {
    render(<Costs />);
    const rows = screen.getAllByTestId("bot-cost-row").map((r) => r.querySelector(".truncate")!.textContent);
    expect(rows[0]).toBe("Pip");
  });

  it("任务表可按花费排序，点两次反向", () => {
    render(<Costs />);
    const titles = () => Array.from(document.querySelectorAll("tbody tr td:first-child")).map((td) => td.textContent);
    fireEvent.click(screen.getByRole("button", { name: /花费$/ }));
    expect(titles()[0]).toBe("写退款接口"); // 0.56 > 0.41
    expect(titles().at(-1)).toBe("修支付回调 bug（幂等键方案）"); // 没有花费数据排最后
    fireEvent.click(screen.getByRole("button", { name: /花费$/ }));
    expect(titles()[0]).toBe("修支付回调 bug");
    expect(screen.getByRole("columnheader", { name: /花费/ }).getAttribute("aria-sort")).toBe("ascending");
  });

  it("审计日志可搜索", () => {
    render(<Costs />);
    fireEvent.change(screen.getByLabelText("搜索审计日志"), { target: { value: "PR #128" } });
    expect(screen.getByText("GitHub · PR #128 已打开 · shop-api")).toBeTruthy();
    expect(screen.queryByText("定时 · 每日 09:00 晨间简报 · 已送达")).toBeNull();
  });
});
