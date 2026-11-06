import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { MethodName } from "@muster/protocol";
import { agents, setupHub } from "../../components/settings/testSetup";
import Onboarding from "./index";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<div>主线页</div>} />
      </Routes>
    </MemoryRouter>,
  );
const step = () => document.querySelector("main")!.getAttribute("data-step");
const next = () => fireEvent.click(screen.getByRole("button", { name: "下一步" }));
const prev = () => fireEvent.click(screen.getByRole("button", { name: "上一步" }));

/** 带模型相关方法的假后端。 */
function setupModelHub(opts: { testOk?: boolean } = {}) {
  const request = setupHub();
  request.mockImplementation(async (method: MethodName) => {
    switch (method) {
      case "bot.detectAgents": return { agents };
      case "model.catalog":
        return { providers: [{ id: "deepseek", name: "DeepSeek", envVar: "DEEPSEEK_API_KEY", modelCount: 3, envConfigured: false, group: "国内" }] };
      case "model.providerUpsert":
        return { provider: { id: "deepseek", kind: "builtin", builtinId: "deepseek", name: "DeepSeek", hasApiKey: true, enabled: true, createdAt: "2026-01-01T00:00:00Z" } };
      case "model.list": return { models: [{ provider: "deepseek", id: "deepseek-chat", name: "DeepSeek Chat" }] };
      case "model.test": return opts.testOk === false ? { ok: false, error: "401 unauthorized" } : { ok: true, latencyMs: 321, reply: "OK" };
      case "model.settingsSet": return { settings: {} };
      default: return {};
    }
  });
  return request;
}

describe("首次引导", () => {
  beforeEach(() => { setupHub(); });
  afterEach(cleanup);

  it("步骤可前进后退，首步不能后退", () => {
    renderPage();
    expect((screen.getByRole("button", { name: "上一步" }) as HTMLButtonElement).disabled).toBe(true);
    next();
    expect(step()).toBe("1");
    next();
    expect(step()).toBe("2");
    prev();
    expect(step()).toBe("1");
  });

  it("名字实时预览；名字为空时不能下一步，并给出校验提示", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("主 Bot 名字"), { target: { value: "团子" } });
    expect(screen.getByTestId("name-preview").textContent).toBe("团子");
    fireEvent.change(screen.getByLabelText("主 Bot 名字"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "下一步" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("名字不能为空")).toBeTruthy();
  });

  it("共 4 步：形象 → 模型 → Agent → 完成，指示器标出当前步", () => {
    renderPage();
    const steps = screen.getByRole("list", { name: "步骤" });
    expect(steps.querySelectorAll("li").length).toBe(4);
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain("形象");
    next();
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain("模型");
  });

  it("走完 4 步：检测 Agent、完成后写入 muster.onboarded、同步 bot.update 并跳转 /", async () => {
    const request = setupModelHub();
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "蜜桃" }));
    next(); // 模型（稍后再说）
    fireEvent.click(screen.getByRole("button", { name: /稍后再说/ }));
    expect(step()).toBe("2");
    await waitFor(() => expect(screen.getByText("已检测到")).toBeTruthy());
    next(); // 完成
    expect(step()).toBe("3");
    expect(screen.getByText(/稍后在 设置 · 模型与连接 中配置/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
    expect(localStorage.getItem("muster.onboarded")).toBe("1");
    expect(JSON.parse(localStorage.getItem("muster.mainBotProfile")!).color).toBe("peach");
    expect(screen.getByText("主线页")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("bot.update", { botId: "bot-pip", patch: { name: "Pip", shape: "round", color: "peach" } });
  });

  it("模型步骤：选 provider、填 key、连接、测试并保存为默认模型", async () => {
    const request = setupModelHub();
    renderPage();
    next();
    fireEvent.click(await screen.findByRole("button", { name: /DeepSeek/ }));
    // 没填 key 时先给校验提示，不发请求
    fireEvent.click(screen.getByRole("button", { name: "连接并获取模型" }));
    expect(screen.getByText("请填写 API Key")).toBeTruthy();
    expect(request).not.toHaveBeenCalledWith("model.providerUpsert", expect.anything());

    fireEvent.change(document.getElementById("ob-key")!, { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "连接并获取模型" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("model.providerUpsert", {
      provider: { id: "deepseek", kind: "builtin", builtinId: "deepseek", name: "DeepSeek", enabled: true },
      apiKey: "sk-test",
    }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("model.list", { providerId: "deepseek" }));

    fireEvent.click(await screen.findByRole("button", { name: "测试并保存为默认模型" }));
    const ref = { provider: "deepseek", modelId: "deepseek-chat" };
    await waitFor(() => expect(request).toHaveBeenCalledWith("model.test", { ref }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("model.settingsSet", { settings: { router: ref, native: ref } }));
    expect(await screen.findByTestId("model-saved")).toBeTruthy();

    // 完成页显示模型摘要
    next(); next();
    await waitFor(() => expect(screen.getByText(/模型：deepseek \/ deepseek-chat/)).toBeTruthy());
  });

  it("模型测试失败：显示错误，不保存设置", async () => {
    const request = setupModelHub({ testOk: false });
    renderPage();
    next();
    fireEvent.click(await screen.findByRole("button", { name: /DeepSeek/ }));
    fireEvent.change(document.getElementById("ob-key")!, { target: { value: "sk-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "连接并获取模型" }));
    fireEvent.click(await screen.findByRole("button", { name: "测试并保存为默认模型" }));
    expect((await screen.findByRole("alert")).textContent).toContain("401 unauthorized");
    expect(request).not.toHaveBeenCalledWith("model.settingsSet", expect.anything());
  });
});
