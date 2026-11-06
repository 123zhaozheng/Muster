// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BotStatus, PebbleShape } from "@muster/protocol";
import {
  Badge, Button, Combobox, ConfirmDialog, CountBadge, DescriptionList, Dot, Drawer, DrawerContent, EmptyState, IconButton, Pebble, Section,
  SettingsRow, Select, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast, Toaster, setReduceMotion, useReducedMotion,
} from "./index";
import { DialogTrigger } from "./overlays";

const STATUSES: BotStatus[] = ["idle", "thinking", "working", "waiting_approval", "done", "error", "sleeping"];
const SHAPES: PebbleShape[] = ["round", "square", "blob", "egg", "flat"];

function mockSystemReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setReduceMotion(false);
  toast.dismiss();
});

describe("Pebble", () => {
  it("每种 status 的结构不同（不靠动画区分），有 title 才暴露为图片", () => {
    const html = STATUSES.map((status) => {
      const { container, unmount } = render(<Pebble status={status} title={`状态-${status}`} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("data-status")).toBe(status);
      expect(svg.getAttribute("aria-label")).toBe(`状态-${status}`);
      const markup = svg.innerHTML;
      unmount();
      return markup;
    });
    expect(new Set(html).size).toBe(STATUSES.length);
    const { container } = render(<Pebble />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("5 种形状输出不同的轮廓，尺寸生效", () => {
    const paths = SHAPES.map((shape) => {
      const { container, unmount } = render(<Pebble shape={shape} size={72} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("width")).toBe("72");
      const d = svg.querySelectorAll("path")[4]?.getAttribute("d") ?? svg.innerHTML;
      unmount();
      return d;
    });
    expect(new Set(paths).size).toBe(SHAPES.length);
  });

  it("系统或应用内“减少动态效果”任一开启时完全静止", () => {
    const { container } = render(<Pebble status="working" />);
    expect(container.querySelector("svg")!.getAttribute("data-motion")).toBe("live");
    cleanup();

    mockSystemReducedMotion(true);
    const sys = render(<Pebble status="working" />);
    expect(sys.container.querySelector("svg")!.getAttribute("data-motion")).toBe("still");
    expect(sys.container.querySelector(".pebble-live")).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    act(() => setReduceMotion(true));
    const app = render(<Pebble status="working" />);
    expect(app.container.querySelector("svg")!.getAttribute("data-motion")).toBe("still");
    expect(app.container.querySelector(".pebble-live, .pebble-interactive")).toBeNull();
    cleanup();

    const off = render(<Pebble status="working" animated={false} />);
    expect(off.container.querySelector("svg")!.getAttribute("data-motion")).toBe("still");
  });

  it("默认是活的：每种状态都有自己的小动画挂点，悬停/点击可互动", () => {
    const { container } = render(<Pebble status="idle" />);
    const svg = container.querySelector("svg")!;
    expect(svg.classList.contains("pebble-live")).toBe(true);
    expect(svg.classList.contains("pebble-interactive")).toBe(true);
    for (const cls of ["pebble-body", "pebble-sprout", "pebble-blink", "pebble-glance", "pebble-look"]) expect(svg.querySelector(`.${cls}`)).not.toBeNull();
    cleanup();

    const hooks: Partial<Record<BotStatus, string>> = {
      thinking: ".pebble-dot-c",
      working: ".pebble-ticks",
      waiting_approval: ".pebble-ring",
      done: ".pebble-cheer",
      error: ".pebble-alert",
      sleeping: ".pebble-zzz-b",
    };
    for (const [status, sel] of Object.entries(hooks)) {
      const r = render(<Pebble status={status as BotStatus} />);
      expect(r.container.querySelector(sel)).not.toBeNull();
      r.unmount();
    }
  });

  it("点击：活的时候跳一下并回调；减少动态效果时只回调不动", () => {
    const animate = vi.fn();
    const proto = SVGElement.prototype as unknown as { animate?: unknown };
    const original = proto.animate;
    proto.animate = animate;
    try {
      const onClick = vi.fn();
      const live = render(<Pebble onClick={onClick} title="Pip" />);
      fireEvent.click(screen.getByRole("img", { name: "Pip" }));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(animate).toHaveBeenCalledTimes(1);
      live.unmount();

      act(() => setReduceMotion(true));
      render(<Pebble onClick={onClick} title="Pip" />);
      fireEvent.click(screen.getByRole("img", { name: "Pip" }));
      expect(onClick).toHaveBeenCalledTimes(2);
      expect(animate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("img", { name: "Pip" }).classList.contains("pebble-interactive")).toBe(false);
    } finally {
      if (original) proto.animate = original;
      else delete proto.animate;
    }
  });
});

describe("Dot / StatusBadge 脉冲", () => {
  it("pulse 时有 ping 环；系统或应用内减少动态效果时没有", () => {
    const { container } = render(
      <div>
        <Dot tone="accent" pulse data-testid="dot" />
        <StatusBadge tone="accent" pulse>执行中</StatusBadge>
      </div>,
    );
    expect(screen.getByTestId("dot").classList.contains("muster-ping")).toBe(true);
    expect(container.querySelectorAll(".muster-ping")).toHaveLength(2);
    cleanup();

    render(<Dot tone="accent" data-testid="dot" />);
    expect(screen.getByTestId("dot").classList.contains("muster-ping")).toBe(false);
    cleanup();

    act(() => setReduceMotion(true));
    const app = render(<Dot tone="accent" pulse />);
    expect(app.container.querySelector(".muster-ping")).toBeNull();
    cleanup();
    act(() => setReduceMotion(false));

    mockSystemReducedMotion(true);
    const sys = render(<StatusBadge tone="accent" pulse>执行中</StatusBadge>);
    expect(sys.container.querySelector(".muster-ping")).toBeNull();
  });
});

describe("减少动态效果偏好", () => {
  function Probe() {
    return <span data-testid="flag">{String(useReducedMotion())}</span>;
  }
  it("setReduceMotion 写入 localStorage 与 html 属性，并驱动 useReducedMotion", () => {
    render(<Probe />);
    expect(screen.getByTestId("flag").textContent).toBe("false");
    act(() => setReduceMotion(true));
    expect(screen.getByTestId("flag").textContent).toBe("true");
    expect(localStorage.getItem("muster.reduceMotion")).toBe("1");
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
    act(() => setReduceMotion(false));
    expect(screen.getByTestId("flag").textContent).toBe("false");
    expect(document.documentElement.dataset.reduceMotion).toBe("false");
  });
  it("与系统偏好取或", () => {
    mockSystemReducedMotion(true);
    render(<Probe />);
    expect(screen.getByTestId("flag").textContent).toBe("true");
  });
});

describe("基础组件", () => {
  it("Button：点击触发，loading 时禁用并标记 busy", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>保存</Button>);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button loading onClick={onClick}>保存</Button>);
    const busy = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
  });

  it("IconButton 以 label 作为可访问名称", () => {
    const onClick = vi.fn();
    render(<IconButton label="关闭面板" onClick={onClick}><span>x</span></IconButton>);
    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("Badge / StatusBadge 显示文字；CountBadge 为 0 时不渲染，超上限显示 max+", () => {
    render(
      <div>
        <Badge tone="accent">Codex</Badge>
        <StatusBadge tone="warning">等你确认</StatusBadge>
        <CountBadge count={0} data-testid="zero" />
        <CountBadge count={120} data-testid="many" />
      </div>,
    );
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("等你确认")).toBeTruthy();
    expect(screen.queryByTestId("zero")).toBeNull();
    expect(screen.getByTestId("many").textContent).toBe("99+");
  });

  it("EmptyState：标题、说明与唯一操作", () => {
    render(<EmptyState title="还没有成员" description="添加后会出现在这里" action={<Button>添加</Button>} />);
    expect(screen.getByText("还没有成员")).toBeTruthy();
    expect(screen.getByText("添加后会出现在这里")).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加" })).toBeTruthy();
  });

  it("Section / SettingsRow / DescriptionList 渲染内容", () => {
    render(
      <Section title="通用" description="说明" card>
        <SettingsRow label="语言" description="界面语言"><span>简体中文</span></SettingsRow>
        <DescriptionList layout="rows" items={[{ label: "版本", value: "0.0.1" }]} />
      </Section>,
    );
    expect(screen.getByRole("heading", { name: "通用" })).toBeTruthy();
    expect(screen.getByText("界面语言")).toBeTruthy();
    expect(screen.getByText("0.0.1")).toBeTruthy();
  });

  it("Textarea 受控输入并转发 onChange", () => {
    const onChange = vi.fn();
    render(<Textarea autoGrow aria-label="内容" value="你好" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "你好呀" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("Tabs 默认显示对应内容", () => {
    render(
      <Tabs defaultValue="b">
        <TabsList>
          <TabsTrigger value="a">甲</TabsTrigger>
          <TabsTrigger value="b">乙</TabsTrigger>
        </TabsList>
        <TabsContent value="a">甲内容</TabsContent>
        <TabsContent value="b">乙内容</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText("乙内容")).toBeTruthy();
    expect(screen.queryByText("甲内容")).toBeNull();
  });
});

describe("浮层", () => {
  it("Drawer：打开后显示标题、内容与底部；Esc 关闭并把焦点还给触发器", async () => {
    render(
      <Drawer>
        <DialogTrigger asChild><Button>打开</Button></DialogTrigger>
        <DrawerContent title="成员详情" description="说明" footer={<Button>保存</Button>}>抽屉内容</DrawerContent>
      </Drawer>,
    );
    const trigger = screen.getByRole("button", { name: "打开" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("成员详情")).toBeTruthy();
    expect(screen.getByText("抽屉内容")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("ConfirmDialog：确认后调用 onConfirm 并关闭", async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} tone="danger" title="删除？" confirmText="删除" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("删除", { selector: "button" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Select 显示当前选项文字", () => {
    render(<Select aria-label="类型" value="b" onValueChange={() => {}} options={[{ value: "a", label: "甲" }, { value: "b", label: "乙" }]} />);
    expect(screen.getByRole("combobox", { name: "类型" }).textContent).toContain("乙");
  });

  it("Combobox：搜索并选择，allowCustom 可提交自定义值", async () => {
    const onChange = vi.fn();
    render(
      <Combobox
        aria-label="模型"
        allowCustom
        onValueChange={onChange}
        options={[{ value: "gpt-5", label: "gpt-5" }, { value: "claude", label: "claude" }]}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "模型" }));
    const input = await screen.findByPlaceholderText("搜索…");
    expect(screen.getByText("claude")).toBeTruthy();
    fireEvent.change(input, { target: { value: "my-model" } });
    fireEvent.click(await screen.findByText("my-model"));
    expect(onChange).toHaveBeenCalledWith("my-model");
  });
});

describe("Toast", () => {
  it("toast() 显示并可 dismiss；error 使用 alert 角色", async () => {
    render(<Toaster />);
    act(() => {
      toast.success({ title: "已保存", description: "细节" });
      toast.error("出错了");
    });
    expect(screen.getByText("已保存")).toBeTruthy();
    expect(screen.getByText("细节")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("出错了");
    act(() => toast.dismiss());
    await waitFor(() => expect(screen.queryByText("已保存")).toBeNull());
  });

  it("toast.promise 先 loading 再变成 success（同一条）", async () => {
    render(<Toaster />);
    let done!: () => void;
    const p = new Promise<void>((r) => (done = r));
    act(() => void toast.promise(p, { loading: "保存中", success: "好了", error: "失败" }));
    expect(screen.getByText("保存中")).toBeTruthy();
    await act(async () => {
      done();
      await p;
    });
    await waitFor(() => expect(screen.getByText("好了")).toBeTruthy());
    expect(screen.queryByText("保存中")).toBeNull();
  });
});
