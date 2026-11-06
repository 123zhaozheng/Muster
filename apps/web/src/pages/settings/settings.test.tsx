import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { polyfillDom, setupModelHub, type FakeDaemon } from "../../components/settings/modelTestSetup";
import Settings from "./index";

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Settings />
    </MemoryRouter>,
  );
}

const upsertCalls = (d: FakeDaemon) => d.request.mock.calls.filter((c) => c[0] === "model.providerUpsert");

describe("设置 · 分区", () => {
  let d: FakeDaemon;
  beforeEach(() => { polyfillDom(); d = setupModelHub(); });
  afterEach(cleanup);

  it("左侧导航列出所有分区，默认进入“模型”", async () => {
    renderAt("/settings");
    for (const t of ["模型", "审批与安全", "通用", "外观", "关于", "组件展示"]) expect(screen.getByRole("tab", { name: t })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "模型" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(screen.getByText("默认模型")).toBeTruthy());
  });

  it("?tab= 定位分区；点击导航切换", () => {
    renderAt("/settings?tab=about");
    expect(screen.getByText("0.0.1")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "通用" }));
    expect(screen.getByText("已连接")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "演示模式" })).toBeTruthy();
  });

  it("审批档位保存到 localStorage", () => {
    renderAt("/settings?tab=safety");
    fireEvent.click(screen.getByRole("radio", { name: "谨慎" }));
    expect(localStorage.getItem("muster.approvalLevel")).toBe("careful");
  });
});

describe("设置 · 模型", () => {
  let d: FakeDaemon;
  beforeEach(() => { polyfillDom(); d = setupModelHub(); });
  afterEach(cleanup);

  it("读取 catalog / providers / list，渲染服务卡与模型表；不显示任何 key", async () => {
    renderAt("/settings?tab=models");
    await waitFor(() => expect(screen.getByTestId("provider-moonshot")).toBeTruthy());
    const card = screen.getByTestId("provider-moonshot");
    expect(within(card).getByText("API Key 已设置")).toBeTruthy();
    expect(within(card).getByText("2 个模型")).toBeTruthy();
    expect(screen.getByText("Kimi K2")).toBeTruthy();
    expect(screen.getByText("推理")).toBeTruthy();
    expect(screen.getByText("视觉")).toBeTruthy();
    expect(screen.getByText("128K")).toBeTruthy();
    expect(screen.queryByDisplayValue(/sk-/)).toBeNull();
  });

  it("设置默认模型：选择后调用 model.settingsSet", async () => {
    renderAt("/settings?tab=models");
    const trigger = await screen.findByRole("combobox", { name: "原生成员默认模型" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = await screen.findByRole("option", { name: /Kimi K2/ });
    fireEvent.keyDown(option, { key: "Enter" });
    await waitFor(() =>
      expect(d.request).toHaveBeenCalledWith("model.settingsSet", { settings: { native: { provider: "moonshot", modelId: "kimi-k2" } } }),
    );
  });

  it("默认模型“测试”显示延迟与回复；失败显示友好原因", async () => {
    d = setupModelHub({ settings: { router: { provider: "moonshot", modelId: "kimi-k2" } } });
    renderAt("/settings?tab=models");
    fireEvent.click(await screen.findByRole("button", { name: "测试Pip 路由模型" }));
    await waitFor(() => expect(screen.getByText(/延迟 321 ms/)).toBeTruthy());
    expect(d.request).toHaveBeenCalledWith("model.test", { ref: { provider: "moonshot", modelId: "kimi-k2" } });
    expect(screen.getByText(/回复：OK/)).toBeTruthy();
  });

  it("测试失败：给出友好的原因", async () => {
    cleanup();
    d = setupModelHub({ settings: { router: { provider: "moonshot", modelId: "kimi-k2" } }, testOk: false });
    renderAt("/settings?tab=models");
    fireEvent.click(await screen.findByRole("button", { name: "测试Pip 路由模型" }));
    await waitFor(() => expect(screen.getByText(/API Key 无效/)).toBeTruthy());
  });

  it("添加内置 provider：只需填 Key，providerUpsert 参数正确", async () => {
    renderAt("/settings?tab=models");
    fireEvent.click((await screen.findAllByRole("button", { name: "添加模型服务" }))[0]!);
    expect(await screen.findByText("国内")).toBeTruthy();
    expect(screen.getByText("已检测到环境变量")).toBeTruthy(); // OpenAI
    fireEvent.click(screen.getByRole("button", { name: "选择 DeepSeek" }));

    // 没填 key 先保存 -> 校验提示，不发请求
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("请填写 API Key")).toBeTruthy();
    expect(upsertCalls(d)).toHaveLength(0);

    const key = screen.getByLabelText(/API Key/) as HTMLInputElement;
    expect(key.type).toBe("password");
    fireEvent.change(key, { target: { value: "sk-deepseek" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(upsertCalls(d)).toHaveLength(1));
    expect(upsertCalls(d)[0]![1]).toEqual({
      provider: { id: "deepseek", kind: "builtin", builtinId: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", enabled: true },
      apiKey: "sk-deepseek",
    });
    // 保存后列表出现新卡片，key 不回显
    await waitFor(() => expect(screen.getByTestId("provider-deepseek")).toBeTruthy());
    expect(screen.queryByDisplayValue("sk-deepseek")).toBeNull();
    expect(document.body.textContent).not.toContain("sk-deepseek");
  });

  it("已检测到环境变量的内置 provider 可以不填 Key", async () => {
    renderAt("/settings?tab=models");
    fireEvent.click((await screen.findAllByRole("button", { name: "添加模型服务" }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "选择 OpenAI" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(upsertCalls(d)).toHaveLength(1));
    expect(upsertCalls(d)[0]![1].apiKey).toBeUndefined();
    expect(upsertCalls(d)[0]![1].provider.id).toBe("openai");
  });

  it("自定义 provider：校验错误，通过后带模型 ID 列表提交", async () => {
    renderAt("/settings?tab=models");
    fireEvent.click((await screen.findAllByRole("button", { name: "添加模型服务" }))[0]!);
    fireEvent.click(await screen.findByRole("radio", { name: "自定义兼容服务" }));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("请给这个服务起个名字")).toBeTruthy();
    expect(screen.getByText("请填写 Base URL")).toBeTruthy();
    expect(screen.getByText("至少添加一个模型 ID")).toBeTruthy();
    expect(upsertCalls(d)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: "本地 Ollama" } });
    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: "localhost:11434" } });
    const tags = screen.getByLabelText(/模型 ID/);
    fireEvent.change(tags, { target: { value: "qwen2.5-coder:7b" } });
    fireEvent.keyDown(tags, { key: "Enter" });
    fireEvent.change(tags, { target: { value: "llama3.1" } });
    fireEvent.keyDown(tags, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText(/需要以 http/)).toBeTruthy();
    expect(upsertCalls(d)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: "http://localhost:11434/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(upsertCalls(d)).toHaveLength(1));
    expect(upsertCalls(d)[0]![1]).toEqual({
      provider: { kind: "openai-compatible", name: "本地 Ollama", baseUrl: "http://localhost:11434/v1", enabled: true, modelIds: ["qwen2.5-coder:7b", "llama3.1"] },
    });
    await waitFor(() => expect(screen.getByTestId("provider-custom-1234")).toBeTruthy());
  });

  it("编辑：Key 输入框永远为空；留空不修改，清除 Key 发送空串", async () => {
    renderAt("/settings?tab=models");
    fireEvent.click(await screen.findByRole("button", { name: "编辑 Moonshot" }));
    const key = (await screen.findByLabelText(/API Key/)) as HTMLInputElement;
    expect(key.value).toBe("");
    expect(key.placeholder).toContain("已设置");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(upsertCalls(d)).toHaveLength(1));
    expect("apiKey" in upsertCalls(d)[0]![1]).toBe(false);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "编辑 Moonshot" }));
    fireEvent.click(await screen.findByRole("button", { name: "清除 Key" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(upsertCalls(d)).toHaveLength(2));
    expect(upsertCalls(d)[1]![1].apiKey).toBe("");
    await waitFor(() => expect(within(screen.getByTestId("provider-moonshot")).getByText("API Key 未设置")).toBeTruthy());
  });

  it("启用开关调用 providerUpsert(enabled)，不带 key", async () => {
    renderAt("/settings?tab=models");
    fireEvent.click(await screen.findByRole("switch", { name: "启用 Moonshot" }));
    await waitFor(() => expect(upsertCalls(d)).toHaveLength(1));
    expect(upsertCalls(d)[0]![1]).toEqual({ provider: { id: "moonshot", kind: "builtin", builtinId: "moonshot", name: "Moonshot", enabled: false } });
  });

  it("删除需要二次确认", async () => {
    renderAt("/settings?tab=models");
    fireEvent.click(await screen.findByRole("button", { name: "删除 Moonshot" }));
    expect(d.request).not.toHaveBeenCalledWith("model.providerDelete", expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    await waitFor(() => expect(d.request).toHaveBeenCalledWith("model.providerDelete", { providerId: "moonshot" }));
  });

  it("添加表单里“测试连接”：先保存再测试，显示结果", async () => {
    renderAt("/settings?tab=models");
    fireEvent.click((await screen.findAllByRole("button", { name: "添加模型服务" }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "选择 DeepSeek" }));
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: "sk-x" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(screen.getByText(/连接成功/)).toBeTruthy());
    expect(upsertCalls(d)).toHaveLength(1);
    expect(d.request).toHaveBeenCalledWith("model.test", expect.objectContaining({ ref: expect.objectContaining({ provider: "deepseek" }) }));
  });

  it("没有 provider 时显示引导空状态", async () => {
    cleanup();
    setupModelHub({ providers: [] });
    renderAt("/settings?tab=models");
    expect(await screen.findByText("还没有模型服务")).toBeTruthy();
  });
});
