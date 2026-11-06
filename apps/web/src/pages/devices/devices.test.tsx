import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { devices as fixtureDevices } from "@muster/protocol/fixtures";
import { useHub } from "../../lib/hub";
import { setupHub } from "../../components/events/testHarness";
import DevicesPage from "./index";

afterEach(cleanup);

describe("DevicesPage", () => {
  const rows = () => screen.getAllByTestId("device-row");
  const rowOf = (name: string) => rows().find((r) => within(r).queryByText(name))!;

  it("lists devices on the left with real online state and shows the local one in the detail", () => {
    setupHub();
    render(<DevicesPage />);
    expect(screen.getByRole("heading", { name: "设备" })).toBeTruthy();
    expect(rows()).toHaveLength(fixtureDevices.length);
    expect(within(rows()[0]!).getByText("MacBook Pro · 本机")).toBeTruthy();
    expect(rows()[0]!.getAttribute("aria-current")).toBe("true");
    expect(within(rowOf("云服务器")).getByText("离线")).toBeTruthy();
    expect(rows().filter((r) => within(r).queryByText(/^在线/))).toHaveLength(2);
    const detail = screen.getByTestId("device-detail");
    expect(within(detail).getByRole("heading", { name: "MacBook Pro · 本机" })).toBeTruthy();
    expect(within(detail).getByText("当前正在使用")).toBeTruthy();
    expect(within(detail).getByText("macOS · 本机")).toBeTruthy();
  });

  it("selecting an offline device shows its real last-seen time", () => {
    setupHub();
    render(<DevicesPage />);
    fireEvent.click(rowOf("云服务器"));
    expect(rowOf("云服务器").getAttribute("aria-current")).toBe("true");
    const detail = screen.getByTestId("device-detail");
    expect(within(detail).getByRole("heading", { name: "云服务器" })).toBeTruthy();
    expect(within(detail).getByText("离线")).toBeTruthy();
    expect(within(detail).getByText(/^2 天前（\d{4}-\d\d-\d\d \d\d:\d\d:\d\d）$/)).toBeTruthy();
  });

  it("shows how many schedules watch the selected device", () => {
    setupHub();
    render(<DevicesPage />);
    expect(within(screen.getByTestId("device-detail")).getByText("没有日程监听这台设备")).toBeTruthy();
    fireEvent.click(rowOf("书房台式机"));
    expect(within(screen.getByTestId("device-detail")).getByText("1 条日程在监听这台设备")).toBeTruthy(); // fixture rule tr-device watches dev-desktop
  });

  it("shows the pairing steps up front, then a code with countdown and the stub notice", async () => {
    const request = setupHub({ "device.pairCode": () => ({ code: "482913", expiresAt: new Date(Date.now() + 300_000).toISOString() }) });
    render(<DevicesPage />);
    expect(screen.getByText("当前版本仅显示配对码，跨机配对即将推出")).toBeTruthy();
    expect(screen.getByText("在新电脑上安装并打开 Muster")).toBeTruthy();
    expect(screen.queryByLabelText("配对码")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "配对新电脑" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("device.pairCode", {}));
    const code = await screen.findByLabelText("配对码");
    expect(code.textContent).toBe("482913");
    expect(screen.getByText(/有效期剩余 [45]:\d\d/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制配对码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新生成配对码" })).toBeTruthy();
  });

  it("marks an expired code", async () => {
    setupHub({ "device.pairCode": () => ({ code: "111222", expiresAt: new Date(Date.now() - 1000).toISOString() }) });
    render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "配对新电脑" }));
    expect(await screen.findByText("配对码已过期，请重新生成")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "复制配对码" })).toBeNull();
  });

  it("reports a pairing failure", async () => {
    setupHub({ "device.pairCode": () => Promise.reject(new Error("daemon 不可用")) });
    render(<DevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "配对新电脑" }));
    expect((await screen.findByRole("alert")).textContent).toBe("daemon 不可用");
  });

  it("shows the remote browser as not connected, with connection steps and no fake session", () => {
    setupHub();
    render(<DevicesPage />);
    const detail = screen.getByTestId("device-detail");
    expect(within(detail).getByText("远程浏览器")).toBeTruthy();
    expect(within(detail).getByText("未接入")).toBeTruthy();
    expect(within(detail).getByText("在设备上启用远程浏览器")).toBeTruthy();
    expect(within(detail).queryByText(/操作中/)).toBeNull();
    expect(screen.queryByLabelText("地址栏")).toBeNull();
    for (const name of ["接管", "暂停", "结束"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("shows an empty state without devices", () => {
    setupHub();
    useHub.setState((s) => ({ model: { ...s.model, devices: {} } }));
    render(<DevicesPage />);
    expect(screen.getByText("还没有设备")).toBeTruthy();
    expect(screen.queryAllByTestId("device-row")).toHaveLength(0);
    expect(screen.queryByTestId("device-detail")).toBeNull();
  });
});
