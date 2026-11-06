import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { setupHub } from "../../components/settings/testSetup";
import { useHub } from "../../lib/hub";
import Costs from "./index";

const renderCosts = () => render(<MemoryRouter><Costs /></MemoryRouter>);

describe("成本", () => {
  beforeEach(() => { setupHub(); });
  afterEach(cleanup);

  it("单一主数字是全部成员累计，并标注口径", () => {
    renderCosts();
    expect(screen.getByText("$6.97")).toBeTruthy(); // 2.18 + 1.24 + 1.87 + 0.72 + 0.96
    expect(screen.getByText(/自守护进程首次启动起累计 · 估算 · USD/)).toBeTruthy();
  });

  it("按成员明细按花费降序，含占比", () => {
    renderCosts();
    const rows = within(screen.getByRole("tabpanel")).getAllByRole("row").slice(1);
    expect(rows[0]!.textContent).toContain("Pip");
    expect(rows[0]!.textContent).toContain("$2.18");
    expect(rows[0]!.textContent).toContain("31%");
  });

  it("切到按任务：按花费降序，没上报的显示 — 且排最后", () => {
    renderCosts();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "按任务" }), { button: 0 });
    const rows = within(screen.getByRole("tabpanel")).getAllByRole("row").slice(1);
    expect(rows[0]!.textContent).toContain("写退款接口");
    expect(rows[0]!.textContent).toContain("$0.56");
    expect(rows.at(-1)!.textContent).toContain("修支付回调 bug（幂等键方案）");
    expect(rows.at(-1)!.textContent).toContain("—");
  });

  it("没有任何花费数据时显示空态，不显示 $0.00", () => {
    act(() => {
      useHub.setState((s) => ({
        model: {
          ...s.model,
          bots: Object.fromEntries(Object.entries(s.model.bots).map(([k, b]) => [k, { ...b, costWeekUsd: 0 }])),
          tasks: {},
        },
      }));
    });
    renderCosts();
    expect(screen.getByText("还没有产生花费")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});
