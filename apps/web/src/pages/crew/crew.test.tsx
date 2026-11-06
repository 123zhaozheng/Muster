import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { bots as fixtureBots } from "@muster/protocol/fixtures";
import type { Bot, DetectedAgent, ModelInfo } from "@muster/protocol";
import { MAIN_BOT_ID } from "@muster/protocol";
import { useHub } from "../../lib/hub";
import { setupHub } from "../../components/events/testHarness";
import CrewPage from "./index";

const agents: DetectedAgent[] = [
  { engine: "claude", command: "claude", version: "2.0.1", found: true },
  { engine: "codex", command: "codex", version: "0.9.0", found: true },
  { engine: "opencode", command: "opencode", found: false },
];
const models: ModelInfo[] = [
  { provider: "deepseek", id: "deepseek-chat", name: "DeepSeek Chat", contextWindow: 128000 },
  { provider: "custom-1", id: "qwen-local", name: "Qwen Local" },
];
const modelHandlers = {
  "model.list": () => ({ models }),
  "model.providers": () => ({
    providers: [
      { id: "deepseek", kind: "builtin" as const, builtinId: "deepseek", name: "DeepSeek", hasApiKey: true, enabled: true, createdAt: "2026-01-01T00:00:00Z" },
      { id: "custom-1", kind: "openai-compatible" as const, name: "本地 Ollama", hasApiKey: false, enabled: true, createdAt: "2026-01-01T00:00:00Z" },
    ],
    settings: {},
  }),
};

beforeAll(() => {
  // jsdom lacks the APIs Radix overlays need
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
function renderCrew(path = "/crew") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="*" element={<CrewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const card = (name: string) => screen.getAllByTestId("crew-card").find((c) => within(c).queryByRole("heading", { name }))!;
const dialog = () => screen.getByRole("dialog");

function addedBot(p: { name: string; kind: Exclude<Bot["kind"], "main"> } & Partial<Bot>): { bot: Bot } {
  return { bot: { ...fixtureBots[3]!, id: "bot-new", ...p } as Bot };
}

describe("CrewPage", () => {
  it("shows Pip as the coordinator and one card per member with real data", () => {
    setupHub();
    renderCrew();
    expect(screen.getByRole("heading", { name: "你的 AI 小队" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /成员 · 4/ })).toBeTruthy();
    expect(screen.getByText("协作方式")).toBeTruthy();

    const pip = within(screen.getByTestId("pip-row"));
    expect(pip.getByText("Pip")).toBeTruthy();
    expect(pip.getByText("协调伙伴")).toBeTruthy();
    expect(screen.getAllByTestId("crew-card")).toHaveLength(fixtureBots.length - 1); // Pip is not in the grid

    const xiaoma = within(card("小码"));
    expect(xiaoma.getByText("Codex")).toBeTruthy(); // engine tag for external agents
    expect(xiaoma.getByText("工作中")).toBeTruthy();
    expect(xiaoma.getByText("技能：代码生成、调试优化")).toBeTruthy();
    expect(xiaoma.getByRole("link", { name: "修支付回调 bug（幂等键方案）" }).getAttribute("href")).toBe("/task/task-fix-callback-b"); // real latest task

    const xiaotan = within(card("小探"));
    expect(xiaotan.getByText("内置研究员")).toBeTruthy();
    expect(xiaotan.getByText("默认模型")).toBeTruthy();
    expect(xiaotan.getByText("最近任务：暂无")).toBeTruthy();
    expect(within(card("阿克")).getByText("等你确认")).toBeTruthy();
  });

  it("shows the configured model id on native cards", () => {
    setupHub();
    useHub.setState((s) => ({ model: { ...s.model, bots: { ...s.model.bots, "bot-xiaotan": { ...s.model.bots["bot-xiaotan"]!, model: { provider: "deepseek", modelId: "deepseek-chat" } } } } }));
    renderCrew();
    expect(within(card("小探")).getByText("deepseek-chat")).toBeTruthy();
  });

  it("send message: latest task if any, otherwise a hint", () => {
    setupHub();
    renderCrew();
    fireEvent.click(within(card("小探")).getByRole("button", { name: "给小探发消息" }));
    expect(within(card("小探")).getByText("还没有任务，回主线派一个吧")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/crew");

    fireEvent.click(within(card("小码")).getByRole("button", { name: "给小码发消息" }));
    expect(screen.getByTestId("where").textContent).toBe("/task/task-fix-callback-b");
  });

  it("add drawer: external agent -> detect, pick, name, bot.add", async () => {
    const request = setupHub({
      "bot.detectAgents": () => ({ agents: agents.slice(0, 2) }), // opencode missing -> still listed, greyed out
      "bot.add": (p) => addedBot({ name: p.name, kind: "claude" }),
    });
    renderCrew();
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    const d = within(dialog());
    expect(d.getByRole("radio", { name: /原生成员/ }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(d.getByRole("radio", { name: /外部编程 Agent/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("bot.detectAgents", {}));
    expect(await screen.findByText("2.0.1")).toBeTruthy();
    expect(screen.getByText("0.9.0")).toBeTruthy();
    expect((screen.getByRole("button", { name: "opencode 未找到" }) as HTMLButtonElement).disabled).toBe(true);
    expect(d.getByText(/安装 OpenCode/)).toBeTruthy(); // install hint
    const submit = d.getByRole("button", { name: "添加成员" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // pick an agent first

    fireEvent.click(screen.getByRole("button", { name: "claude 已检测到" }));
    fireEvent.click(submit);
    expect(d.getByText("给 TA 起个名字吧")).toBeTruthy(); // name required

    fireEvent.change(d.getByLabelText(/名字/), { target: { value: "小克" } });
    fireEvent.change(d.getByLabelText("专长"), { target: { value: "长文分析" } });
    fireEvent.click(d.getByRole("button", { name: "颜色 天空" }));
    fireEvent.click(d.getByRole("button", { name: "形状 蛋蛋" }));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("bot.add", { name: "小克", kind: "claude", engineLabel: "Claude", color: "sky", shape: "egg", skills: [], tagline: "长文分析" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("add drawer: native member with persona template, model, tools and skills", async () => {
    const request = setupHub({
      ...modelHandlers,
      "bot.add": (p) => addedBot({ name: p.name, kind: "native" }),
    });
    renderCrew();
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    const d = within(dialog());
    fireEvent.change(d.getByLabelText(/名字/), { target: { value: "小研" } });
    fireEvent.click(d.getByRole("button", { name: "颜色 天空" }));
    fireEvent.click(d.getByRole("button", { name: "形状 圆圆" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith("model.list", {}));
    fireEvent.click(d.getByRole("button", { name: "研究员" }));
    expect((d.getByLabelText("人设") as HTMLTextAreaElement).value).toContain("严谨的研究员");
    expect(d.getByRole("checkbox", { name: /网页抓取/ }).getAttribute("aria-checked")).toBe("true"); // template turned web on

    fireEvent.keyDown(d.getByLabelText("模型"), { key: "Enter" });
    expect(await screen.findByRole("option", { name: /使用默认模型/ })).toBeTruthy();
    expect(screen.getByText("本地 Ollama")).toBeTruthy(); // grouped by provider name
    fireEvent.click(await screen.findByRole("option", { name: /DeepSeek Chat/ }));

    fireEvent.click(d.getByRole("checkbox", { name: /运行命令/ }));
    const skillInput = d.getByLabelText("添加技能");
    fireEvent.change(skillInput, { target: { value: "论文速读" } });
    fireEvent.keyDown(skillInput, { key: "Enter" });
    fireEvent.click(d.getByRole("button", { name: "添加成员" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("bot.add", {
        name: "小研", kind: "native", color: "sky", shape: "round",
        persona: expect.stringContaining("严谨的研究员"),
        model: { provider: "deepseek", modelId: "deepseek-chat" },
        tools: ["files", "shell", "web"],
        skills: ["研究调研", "信息检索", "论文速读"],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("add drawer: warns when no models exist, rejects duplicate names, stays open on error", async () => {
    const request = setupHub({
      "model.list": () => ({ models: [] }),
      "model.providers": () => ({ providers: [], settings: {} }),
      "bot.add": () => {
        throw new Error("已有同名 Bot：小新");
      },
    });
    renderCrew();
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    const d = within(dialog());
    fireEvent.change(d.getByLabelText(/名字/), { target: { value: "小码" } });
    fireEvent.click(d.getByRole("button", { name: "添加成员" }));
    expect(d.getByText("团队里已经有同名成员了")).toBeTruthy();
    expect(request).not.toHaveBeenCalledWith("bot.add", expect.anything());

    expect(await d.findByText(/还没有可用的模型/)).toBeTruthy();
    expect(d.getByRole("button", { name: "去设置" })).toBeTruthy();

    fireEvent.change(d.getByLabelText(/名字/), { target: { value: "小新" } });
    fireEvent.click(d.getByRole("button", { name: "添加成员" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("bot.add", expect.objectContaining({ name: "小新", kind: "native" })));
    expect((await d.findByRole("alert")).textContent).toContain("已有同名 Bot");
  });

  it("opens the add drawer from ?new=1 and clears the param", async () => {
    setupHub();
    renderCrew("/crew?new=1");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByTestId("where").textContent).toBe("/crew");
  });

  it("configure: saves only changed fields through bot.update", async () => {
    const request = setupHub({
      ...modelHandlers,
      "bot.update": (p) => ({ bot: { ...fixtureBots[3]!, ...p.patch } as Bot }),
    });
    renderCrew();
    fireEvent.click(within(card("小探")).getByRole("button", { name: "配置小探" }));
    const d = within(dialog());
    const save = () => d.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true); // nothing changed yet

    fireEvent.change(d.getByLabelText(/名字/), { target: { value: "小探探" } });
    fireEvent.change(d.getByLabelText("专长"), { target: { value: "查资料" } });
    fireEvent.change(d.getByLabelText("人设"), { target: { value: "只查资料" } });
    fireEvent.click(d.getByRole("checkbox", { name: /网页抓取/ }));
    fireEvent.click(d.getByRole("button", { name: "颜色 丁香" }));
    expect(save().disabled).toBe(false);
    fireEvent.click(save());

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("bot.update", {
        botId: "bot-xiaotan",
        patch: { name: "小探探", color: "lilac", tagline: "查资料", persona: "只查资料", tools: ["web"] },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("configure Pip: only name, look and the router model", async () => {
    const request = setupHub({
      ...modelHandlers,
      "bot.update": (p) => ({ bot: { ...fixtureBots[0]!, ...p.patch } as Bot }),
    });
    renderCrew();
    fireEvent.click(within(screen.getByTestId("pip-row")).getByRole("button", { name: "编辑Pip" }));
    const d = within(dialog());
    expect(d.getByText(/Pip 只允许修改名字/)).toBeTruthy();
    expect(d.queryByLabelText("人设")).toBeNull();
    expect(d.queryByLabelText("专长")).toBeNull();
    expect(d.queryByRole("checkbox", { name: /网页抓取/ })).toBeNull();
    expect(d.queryByLabelText("添加技能")).toBeNull();
    expect(d.queryByRole("button", { name: "删除成员" })).toBeNull();
    expect(await d.findByText(/Pip 用这个模型理解你的话/)).toBeTruthy();

    fireEvent.keyDown(d.getByLabelText("路由模型"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Qwen Local/ }));
    fireEvent.click(d.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("bot.update", { botId: MAIN_BOT_ID, patch: { model: { provider: "custom-1", modelId: "qwen-local" } } }),
    );
  });

  it("delete: built-in members cannot be removed; others need a second confirmation", async () => {
    const request = setupHub({ ...modelHandlers, "bot.remove": () => ({ ok: true as const }) });
    useHub.setState((s) => ({ model: { ...s.model, bots: { ...s.model.bots, "bot-xiaowen": { ...s.model.bots["bot-xiaowen"]!, builtin: true } } } }));
    renderCrew();

    fireEvent.click(within(card("小文")).getByRole("button", { name: "配置小文" }));
    expect(within(dialog()).queryByRole("button", { name: "删除成员" })).toBeNull();
    fireEvent.click(within(dialog()).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(within(card("小码")).getByRole("button", { name: "配置小码" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "删除成员" }));
    const confirm = await screen.findByRole("dialog", { name: /删除 小码/ });
    expect(request).not.toHaveBeenCalledWith("bot.remove", expect.anything());
    fireEvent.click(within(confirm).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("bot.remove", { botId: "bot-xiaoma" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("delete: stays open and reports the error when the daemon refuses", async () => {
    const request = setupHub({
      ...modelHandlers,
      "bot.remove": () => {
        throw new Error("小码 还有进行中的任务");
      },
    });
    renderCrew();
    fireEvent.click(within(card("小码")).getByRole("button", { name: "配置小码" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "删除成员" }));
    const confirm = await screen.findByRole("dialog", { name: /删除 小码/ });
    fireEvent.click(within(confirm).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("bot.remove", { botId: "bot-xiaoma" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /删除 小码/ })).toBeTruthy());
  });
});
