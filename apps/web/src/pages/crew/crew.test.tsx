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
  // jsdom 缺少 Radix 浮层需要的 API
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
const next = () => fireEvent.click(within(dialog()).getByRole("button", { name: /下一步/ }));

function addedBot(p: { name: string; kind: Exclude<Bot["kind"], "main"> } & Partial<Bot>): { bot: Bot } {
  return { bot: { ...fixtureBots[3]!, id: "bot-new", ...p } as Bot };
}

describe("CrewPage", () => {
  it("renders overview stats and one rich card per bot", () => {
    setupHub();
    renderCrew();
    expect(screen.getByRole("heading", { name: "团队" })).toBeTruthy();
    expect(screen.getByText(/共 5 位成员/)).toBeTruthy();
    expect(screen.getByLabelText("团队概览").textContent).toContain("本周花费");
    expect(screen.getAllByTestId("crew-card")).toHaveLength(fixtureBots.length);

    const xiaoma = within(card("小码"));
    expect(xiaoma.getByText("Codex")).toBeTruthy(); // type badge
    expect(xiaoma.getByText("工作中")).toBeTruthy();
    expect(xiaoma.getByText("修支付回调 bug")).toBeTruthy(); // current task
    expect(xiaoma.getByText("$1.24")).toBeTruthy();
    expect(xiaoma.getByText("代码生成")).toBeTruthy();
    expect(xiaoma.queryByText("默认模型")).toBeNull(); // external agents manage their own model

    const xiaotan = within(card("小探"));
    expect(xiaotan.getByText("原生")).toBeTruthy();
    expect(xiaotan.getByText("内置研究员")).toBeTruthy();
    expect(xiaotan.getByText("默认模型")).toBeTruthy();
    expect(within(card("Pip")).getByText("主 Bot")).toBeTruthy();
    expect(within(card("阿克")).getByText("等你审批")).toBeTruthy();
    expect(screen.getAllByTestId("crew-card")[0]!.textContent).toContain("Pip"); // main bot first
  });

  it("shows the configured model id on native cards", () => {
    setupHub();
    useHub.setState((s) => ({ model: { ...s.model, bots: { ...s.model.bots, "bot-xiaotan": { ...s.model.bots["bot-xiaotan"]!, model: { provider: "deepseek", modelId: "deepseek-chat" } } } } }));
    renderCrew();
    expect(within(card("小探")).getByText("deepseek-chat")).toBeTruthy();
  });

  it("chat button: main -> /, sub bot -> latest task, no task -> hint", () => {
    setupHub();
    renderCrew();
    fireEvent.click(within(card("小码")).getByRole("button", { name: "和小码聊天" }));
    expect(screen.getByTestId("where").textContent).toBe("/task/task-fix-callback-b");

    fireEvent.click(within(card("小探")).getByRole("button", { name: "和小探聊天" }));
    expect(within(card("小探")).getByText("还没有任务，回主线派一个吧")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/task/task-fix-callback-b");

    fireEvent.click(within(card("Pip")).getByRole("button", { name: "和Pip聊天" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("wizard: external agent -> detect, pick, look, confirm, bot.add", async () => {
    const request = setupHub({
      "bot.detectAgents": () => ({ agents: agents.slice(0, 2) }), // opencode missing -> still listed, greyed out
      "bot.add": (p) => addedBot({ name: p.name, kind: "claude" }),
    });
    renderCrew();
    fireEvent.click(screen.getByRole("button", { name: "新建成员" }));
    expect(within(dialog()).getByText("原生成员")).toBeTruthy();
    expect((within(dialog()).getByRole("button", { name: "下一步" }) as HTMLButtonElement).disabled).toBe(false); // native default

    fireEvent.click(within(dialog()).getByRole("radio", { name: /外部编程 Agent/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("bot.detectAgents", {}));
    expect(await screen.findByText("2.0.1")).toBeTruthy();
    expect(screen.getByText("0.9.0")).toBeTruthy();
    const opencode = screen.getByRole("button", { name: "opencode 未找到" }) as HTMLButtonElement;
    expect(opencode.disabled).toBe(true);
    expect(within(dialog()).getByText(/安装 OpenCode/)).toBeTruthy(); // install hint
    expect((within(dialog()).getByRole("button", { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(true); // pick one first

    fireEvent.click(screen.getByRole("button", { name: "claude 已检测到" }));
    next();
    // look step: name required
    next();
    expect(within(dialog()).getByText("给 TA 起个名字吧")).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText(/名字/), { target: { value: "小克" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "颜色 玫瑰" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "形状 蛋蛋" }));
    next();
    expect(within(dialog()).getByText("小克")).toBeTruthy(); // confirm summary (no ability step for external)
    fireEvent.click(within(dialog()).getByRole("button", { name: "创建成员" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith("bot.add", { name: "小克", kind: "claude", engineLabel: "Claude", color: "rose", shape: "egg" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("wizard: native member with persona template, model, tools and skills", async () => {
    const request = setupHub({
      ...modelHandlers,
      "bot.add": (p) => addedBot({ name: p.name, kind: "native" }),
    });
    renderCrew();
    fireEvent.click(screen.getByRole("button", { name: "新建成员" }));
    next(); // native is the default type
    fireEvent.change(within(dialog()).getByLabelText(/名字/), { target: { value: "小研" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "颜色 天空" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "形状 圆圆" }));
    next();

    // ability step
    await waitFor(() => expect(request).toHaveBeenCalledWith("model.list", {}));
    fireEvent.click(within(dialog()).getByRole("button", { name: "研究员" }));
    const persona = within(dialog()).getByLabelText("人设") as HTMLTextAreaElement;
    expect(persona.value).toContain("严谨的研究员");
    expect(within(dialog()).getByRole("checkbox", { name: /网页抓取/ }).getAttribute("aria-checked")).toBe("true"); // template turned web on

    fireEvent.keyDown(within(dialog()).getByLabelText("模型"), { key: "Enter" });
    expect(await screen.findByRole("option", { name: /使用默认模型/ })).toBeTruthy();
    expect(screen.getByText("本地 Ollama")).toBeTruthy(); // grouped by provider name
    fireEvent.click(await screen.findByRole("option", { name: /DeepSeek Chat/ }));

    fireEvent.click(within(dialog()).getByRole("checkbox", { name: /运行命令/ }));
    const skillInput = within(dialog()).getByLabelText("添加技能");
    fireEvent.change(skillInput, { target: { value: "论文速读" } });
    fireEvent.keyDown(skillInput, { key: "Enter" });
    next();

    const confirm = within(dialog());
    expect(confirm.getByText("DeepSeek Chat")).toBeTruthy();
    expect(confirm.getByText("论文速读")).toBeTruthy();
    fireEvent.click(confirm.getByRole("button", { name: "创建成员" }));

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

  it("wizard: warns to configure models when none exist, rejects duplicate names, keeps sheet open on error", async () => {
    const request = setupHub({
      "model.list": () => ({ models: [] }),
      "model.providers": () => ({ providers: [], settings: {} }),
      "bot.add": () => {
        throw new Error("已有同名 Bot：小新");
      },
    });
    renderCrew();
    fireEvent.click(screen.getByRole("button", { name: "新建成员" }));
    next();
    fireEvent.change(within(dialog()).getByLabelText(/名字/), { target: { value: "小码" } });
    next();
    expect(within(dialog()).getByText("团队里已经有同名成员了")).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText(/名字/), { target: { value: "小新" } });
    next();
    expect(await within(dialog()).findByText(/还没有可用的模型/)).toBeTruthy();
    expect(within(dialog()).getByRole("button", { name: "去设置" })).toBeTruthy();
    next();
    fireEvent.click(within(dialog()).getByRole("button", { name: "创建成员" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("bot.add", expect.objectContaining({ name: "小新", kind: "native" })));
    expect((await within(dialog()).findByRole("alert")).textContent).toContain("已有同名 Bot");
  });

  it("opens the wizard from ?new=1 and clears the param", async () => {
    setupHub();
    renderCrew("/crew?new=1");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByTestId("where").textContent).toBe("/crew");
  });

  it("edit: saves only changed fields through bot.update", async () => {
    const request = setupHub({
      ...modelHandlers,
      "bot.update": (p) => ({ bot: { ...fixtureBots[3]!, ...p.patch } as Bot }),
    });
    renderCrew();
    fireEvent.click(within(card("小探")).getByRole("button", { name: "编辑小探" }));
    const save = () => within(dialog()).getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true); // nothing changed yet

    fireEvent.change(within(dialog()).getByLabelText(/名字/), { target: { value: "小探探" } });
    fireEvent.change(within(dialog()).getByLabelText("人设"), { target: { value: "只查资料" } });
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: /网页抓取/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "颜色 玫瑰" }));
    expect(save().disabled).toBe(false);
    fireEvent.click(save());

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("bot.update", {
        botId: "bot-xiaotan",
        patch: { name: "小探探", color: "rose", persona: "只查资料", tools: ["web"] },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edit: Pip only exposes name, look and the router model", async () => {
    const request = setupHub({
      ...modelHandlers,
      "bot.update": (p) => ({ bot: { ...fixtureBots[0]!, ...p.patch } as Bot }),
    });
    renderCrew();
    fireEvent.click(within(card("Pip")).getByRole("button", { name: "编辑Pip" }));
    const d = within(dialog());
    expect(d.getByText(/Pip 只允许修改名字/)).toBeTruthy();
    expect(d.queryByLabelText("人设")).toBeNull();
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

  it("delete: confirm dialog then bot.remove; builtin and main bots cannot be removed", async () => {
    const request = setupHub({ ...modelHandlers, "bot.remove": () => ({ ok: true as const }) });
    useHub.setState((s) => ({ model: { ...s.model, bots: { ...s.model.bots, "bot-xiaowen": { ...s.model.bots["bot-xiaowen"]!, builtin: true } } } }));
    renderCrew();

    // builtin: no delete in the edit sheet
    fireEvent.click(within(card("小文")).getByRole("button", { name: "编辑小文" }));
    expect(within(dialog()).queryByRole("button", { name: "删除成员" })).toBeNull();
    fireEvent.click(within(dialog()).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // builtin in the more menu: disabled item
    fireEvent.keyDown(within(card("小文")).getByRole("button", { name: "小文更多操作" }), { key: "Enter" });
    expect((await screen.findByRole("menuitem", { name: /内置成员不可删除/ })).getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    // normal bot: more menu -> delete -> confirm
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(within(card("小码")).getByRole("button", { name: "小码更多操作" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
    const confirm = await screen.findByRole("dialog", { name: /删除 小码/ });
    expect(request).not.toHaveBeenCalledWith("bot.remove", expect.anything()); // needs the second confirmation
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
    fireEvent.click(within(card("小码")).getByRole("button", { name: "编辑小码" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "删除成员" })); // sheet closes, confirm opens
    const confirm = await screen.findByRole("dialog", { name: /删除 小码/ });
    fireEvent.click(within(confirm).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("bot.remove", { botId: "bot-xiaoma" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /删除 小码/ })).toBeTruthy());
  });
});
