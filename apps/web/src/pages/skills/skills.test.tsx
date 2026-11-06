import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { setupHub } from "../../components/settings/testSetup";
import Skills from "./index";

describe("技能", () => {
  let request: ReturnType<typeof setupHub>;
  beforeEach(() => { request = setupHub(); });
  afterEach(cleanup);

  it("只有“已安装”页签；外部 Agent 来自 bot.detectAgents，并提示原生成员", async () => {
    render(<MemoryRouter><Skills /></MemoryRouter>);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["已安装"]);
    expect(screen.getByText("外部 Agent")).toBeTruthy();
    expect(screen.getByText("原生成员")).toBeTruthy();
    expect(screen.getByRole("link", { name: /去配置模型/ }).getAttribute("href")).toBe("/settings?tab=models");
    await waitFor(() => expect(screen.getByText("已检测到")).toBeTruthy());
    expect(screen.getByText("未检测到")).toBeTruthy();
    expect(screen.getByText("登录方式：在终端运行 codex login")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("bot.detectAgents", {});
  });

  it("没有 SKILL.md 与 MCP 数据时给出诚实空态，不出现搜索与筛选", () => {
    render(<MemoryRouter><Skills /></MemoryRouter>);
    expect(screen.getByText("还没有已安装的技能")).toBeTruthy();
    expect(screen.getByText("还没有连接 MCP 服务器")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("成员的能力标签来自 hub 数据", () => {
    render(<MemoryRouter><Skills /></MemoryRouter>);
    expect(screen.getByText("各成员当前的能力标签")).toBeTruthy();
  });

  it("“重新检测”再次调用 bot.detectAgents", async () => {
    render(<MemoryRouter><Skills /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("已检测到")).toBeTruthy());
    const before = request.mock.calls.filter((c) => c[0] === "bot.detectAgents").length;
    screen.getByRole("button", { name: /重新检测/ }).click();
    await waitFor(() => expect(request.mock.calls.filter((c) => c[0] === "bot.detectAgents").length).toBe(before + 1));
  });
});
