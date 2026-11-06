import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { devices as fixtureDevices } from "@muster/protocol/fixtures";
import { useHub } from "../../lib/hub";
import { setupHub } from "../../components/events/testHarness";
import DevicesPage from "./index";

afterEach(cleanup);

describe("DevicesPage", () => {
  it("renders header, overview stats and device cards with online state and last-seen time", () => {
    setupHub();
    render(<DevicesPage />);
    expect(screen.getByRole("heading", { name: "设备" })).toBeTruthy();
    expect(screen.getByText("设备总数")).toBeTruthy();
    expect(screen.getByText("在线设备")).toBeTruthy();
    expect(screen.getByText("离线设备")).toBeTruthy();
    const cards = screen.getAllByTestId("device-card");
    expect(cards).toHaveLength(fixtureDevices.length);
    expect(within(cards[0]!).getByText("MacBook Pro · 本机")).toBeTruthy();
    expect(within(cards[0]!).getByText("本机")).toBeTruthy();
    expect(within(cards[0]!).getByText("当前正在使用的设备")).toBeTruthy();
    const cloud = cards.find((c) => within(c).queryByText("云服务器"))!;
    expect(within(cloud).getByText("离线")).toBeTruthy();
    expect(within(cloud).getByText(/最后在线/)).toBeTruthy();
    expect(screen.getAllByText("在线")).toHaveLength(2);
  });

  it("tags devices with the rules that watch them", () => {
    setupHub();
    render(<DevicesPage />);
    const desktop = screen.getAllByTestId("device-card").find((c) => within(c).queryByText("书房台式机"))!;
    expect(within(desktop).getByText("1 条规则监听")).toBeTruthy(); // fixture rule tr-device watches dev-desktop
    expect(within(desktop).getByText("可接收任务")).toBeTruthy();
  });

  it("shows the pairing steps up front, then a code with countdown ring and the stub notice", async () => {
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

  it("renders the remote browser preview with disabled controls", () => {
    setupHub();
    render(<DevicesPage />);
    expect(screen.getByText("即将推出")).toBeTruthy();
    expect(screen.getByText("远程浏览器即将推出：让小探在你的电脑上操作网页，你可随时接管")).toBeTruthy();
    expect(screen.getByLabelText("地址栏")).toBeTruthy();
    for (const t of ["实时画面", "随时接管", "敏感操作需确认"]) expect(screen.getByText(t)).toBeTruthy();
    for (const name of ["接管", "暂停", "结束"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an empty state without devices", () => {
    setupHub();
    useHub.setState((s) => ({ model: { ...s.model, devices: {} } }));
    render(<DevicesPage />);
    expect(screen.getByText("还没有设备")).toBeTruthy();
    expect(screen.queryAllByTestId("device-card")).toHaveLength(0);
  });
});
