import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { setupHub } from "../../components/settings/testSetup";
import Skills from "./index";

describe("技能", () => {
  let request: ReturnType<typeof setupHub>;
  beforeEach(() => { request = setupHub(); });
  afterEach(cleanup);

  it("分区渲染，外部 Agent 来自 bot.detectAgents，并提示原生成员", async () => {
    render(<MemoryRouter><Skills /></MemoryRouter>);
    expect(screen.getByText("外部 Agent")).toBeTruthy();
    expect(screen.getByText("MCP 服务器")).toBeTruthy();
    expect(screen.getByText("将兼容 ~/.agents/skills 与 .claude/skills")).toBeTruthy();
    expect(screen.getByText("原生成员")).toBeTruthy();
    expect(screen.getByRole("link", { name: /去配置模型/ }).getAttribute("href")).toBe("/settings?tab=models");
    await waitFor(() => expect(screen.getByText("已检测到")).toBeTruthy());
    expect(screen.getByText("未检测到")).toBeTruthy();
    expect(screen.getByText("登录方式：在终端运行 codex login")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("bot.detectAgents", {});
  });

  it("“重新检测”再次调用 bot.detectAgents", async () => {
    render(<MemoryRouter><Skills /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("已检测到")).toBeTruthy());
    const before = request.mock.calls.filter((c) => c[0] === "bot.detectAgents").length;
    screen.getByRole("button", { name: /重新检测/ }).click();
    await waitFor(() => expect(request.mock.calls.filter((c) => c[0] === "bot.detectAgents").length).toBe(before + 1));
  });
});
