// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BotStatus, PebbleShape } from "@muster/protocol";
import {
  AnimatedNumber, AvatarGroup, AvatarStack, Badge, Button, Card, Chip, Combobox, CommandPalette, ConfirmDialog, CountBadge, DescriptionList, Dialog,
  DialogContent, DialogTrigger, Dot, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Empty, EmptyState, Field, IconButton,
  Input, Kbd, PageHeader, Pebble, ProgressBar, Pulse, ScrollArea, Section, SectionTitle, Segmented, Select, Sheet, SheetContent, Skeleton, Slider,
  STATUS_LABEL, StatCard, StatusPill, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast, Toaster, Tooltip, UiGallery,
} from "./index";

const STATUSES: BotStatus[] = ["idle", "thinking", "working", "waiting_approval", "done", "error", "sleeping"];
const SHAPES: PebbleShape[] = ["round", "square", "blob", "egg", "flat"];

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeAll(() => {
  // Radix ScrollArea / Tooltip / Select / cmdk observe sizes and scroll; jsdom has none of that.
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
  toast.dismiss();
});

describe("Pebble", () => {
  it("每种 status 的 aria-label、动画 class 与结构都不同", () => {
    const labels = new Set<string>();
    const classes = new Set<string>();
    const structures = new Set<string>();
    for (const status of STATUSES) {
      const { container, unmount } = render(<Pebble status={status} />);
      const svg = container.querySelector("svg")!;
      labels.add(svg.getAttribute("aria-label")!);
      expect(svg.getAttribute("aria-label")).toBe(STATUS_LABEL[status]);
      expect(svg.getAttribute("data-status")).toBe(status);
      expect(svg.getAttribute("class")).toContain(`pebble-anim-${status}`);
      classes.add(svg.getAttribute("class")!);
      // 去掉随机 id 后比较内部结构
      structures.add(svg.innerHTML.replace(/(id="|url\(#)[^")]*/g, "$1ID"));
      unmount();
    }
    expect(labels.size).toBe(STATUSES.length);
    expect(classes.size).toBe(STATUSES.length);
    expect(structures.size).toBe(STATUSES.length);
  });

  it("5 种形状输出不同的 path，尺寸与 title 生效", () => {
    const bodies = new Set<string>();
    for (const shape of SHAPES) {
      const { container, unmount } = render(<Pebble shape={shape} size={160} title="小码" />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("width")).toBe("160");
      expect(svg.getAttribute("aria-label")).toBe("小码");
      bodies.add(svg.querySelector('path[fill="var(--color-pebble-cream)"]')?.getAttribute("d") ?? shape);
      unmount();
    }
    expect(bodies.size).toBe(SHAPES.length);
  });

  it("animated=false 时不带动画 class 也没有交互", () => {
    const { container } = render(<Pebble status="working" animated={false} />);
    const cls = container.querySelector("svg")!.getAttribute("class")!;
    expect(cls).not.toContain("pebble-anim-");
    expect(cls).not.toContain("pebble-interactive");
    expect(container.querySelector("svg")!.getAttribute("data-motion")).toBe("still");
  });

  it("prefers-reduced-motion 下没有任何动画类", () => {
    mockReducedMotion(true);
    for (const status of STATUSES) {
      const { container, unmount } = render(<Pebble status={status} halo />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("class")).not.toContain("pebble-anim-");
      expect(svg.getAttribute("class")).not.toContain("pebble-interactive");
      expect(svg.getAttribute("data-motion")).toBe("still");
      unmount();
    }
  });

  it("lite 只保留降级动画，halo / mood / interactive 开关生效", () => {
    const lite = render(<Pebble lite status="working" />).container.querySelector("svg")!;
    expect(lite.getAttribute("class")).toContain("pebble-lite");
    expect(lite.getAttribute("class")).not.toContain("pebble-interactive");
    expect(lite.getAttribute("data-motion")).toBe("lite");
    cleanup();

    const full = render(<Pebble status="idle" halo mood="lively" />).container.querySelector("svg")!;
    expect(full.getAttribute("class")).toContain("pebble-interactive");
    expect(full.querySelector(".pebble-halo")).not.toBeNull();
    expect(full.style.getPropertyValue("--pb-k")).toBe("1.5");
    cleanup();

    const noInteract = render(<Pebble interactive={false} />).container.querySelector("svg")!;
    expect(noInteract.getAttribute("class")).not.toContain("pebble-interactive");
    expect(noInteract.querySelector(".pebble-halo")).toBeNull();
  });

  it("hover 时眼睛跟随鼠标，点击触发 onClick", () => {
    const onClick = vi.fn();
    const { container } = render(<Pebble size={100} onClick={onClick} />);
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerMove(svg, { clientX: 100, clientY: 55 });
    expect(Number(svg.style.getPropertyValue("--ex"))).toBeGreaterThan(3);
    fireEvent.pointerLeave(svg);
    expect(svg.style.getPropertyValue("--ex")).toBe("0");
    fireEvent.click(svg);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("30 个同屏 lite 头像可渲染", () => {
    const { container } = render(
      <div>
        {Array.from({ length: 30 }, (_, i) => (
          <Pebble key={i} lite size={24} status={STATUSES[i % 7]} />
        ))}
      </div>,
    );
    expect(container.querySelectorAll("svg.pebble-lite").length).toBe(30);
  });
});

describe("components render", () => {
  it("基础组件", () => {
    render(
      <div>
        <Button>按钮</Button>
        <Button loading>加载</Button>
        <Card>卡片</Card>
        <Chip>标签</Chip>
        <StatusPill status="working" />
        <Segmented value="a" onChange={() => {}} options={[{ value: "a", label: "甲" }]} />
        <Input placeholder="输入" />
        <Textarea placeholder="多行" />
        <Switch aria-label="开关" defaultChecked />
        <Slider value={30} onValueChange={() => {}} aria-label="滑块" />
        <ProgressBar value={50} label="进度" />
        <Kbd>Esc</Kbd>
        <SectionTitle title="标题" subtitle="副标题" action={<Button>操作</Button>} />
        <EmptyState title="空空如也" description="说明" />
        <AvatarGroup bots={[{ id: "a" }, { id: "b" }, { id: "c" }]} max={2} />
        <ScrollArea className="h-10">内容</ScrollArea>
      </div>,
    );
    expect(screen.getByText("卡片")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "开关" }).getAttribute("data-state")).toBe("checked");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("空空如也")).toBeTruthy();
    expect(screen.getByText("加载").closest("button")!.hasAttribute("disabled")).toBe(true);
  });

  it("v2 展示组件", () => {
    const { container } = render(
      <div>
        <PageHeader title="团队" subtitle="你的 AI 团队" actions={<Button>添加</Button>} pebble={{ status: "idle" }} />
        <Section title="区块" description="区块说明" actions={<Button>更多</Button>} card>
          内容
        </Section>
        <StatCard label="任务" value={42} trend={{ value: 5 }} sparkline={[1, 3, 2, 5]} />
        <StatCard label="花费" value={3.5} decimals={2} prefix="$" trend={{ value: 8, inverse: true }} />
        <Empty title="没有数据" description="去创建" action={<Button>创建</Button>} />
        <Skeleton className="h-4 w-10" />
        <AvatarStack items={[{ id: "a", name: "小码" }, { id: "b" }, { id: "c" }]} max={2} />
        <Badge tone="coral" variant="outline" dot>徽标</Badge>
        <CountBadge count={120} />
        <CountBadge count={0} />
        <Dot tone="mint" />
        <Pulse status="working" />
        <DescriptionList items={[{ label: "模型", value: "gpt-5", mono: true }, { label: "状态", value: "在线" }]} />
        <DescriptionList layout="rows" items={[{ label: "区域", value: "cn" }]} />
        <Field label="名称" error="必填"><Input aria-invalid /></Field>
      </div>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("团队");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("区块");
    expect(screen.getByLabelText("42").textContent).toBe("42");
    expect(screen.getByLabelText("$3.50")).toBeTruthy();
    expect(screen.getByText("99+")).toBeTruthy();
    expect(container.querySelectorAll(".muster-count-pop").length).toBe(1);
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("gpt-5")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("必填");
    expect(container.querySelectorAll(".muster-skeleton").length).toBe(1);
  });

  it("IconButton 有可访问名称", () => {
    render(<IconButton label="设置" tooltip={false}>⚙</IconButton>);
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
  });

  it("AnimatedNumber：reduced motion 下直接显示最终值，否则 aria-label 恒为最终值", () => {
    mockReducedMotion(true);
    const a = render(<AnimatedNumber value={1234.5} decimals={1} />);
    expect(a.container.textContent).toBe("1,234.5");
    a.unmount();
    mockReducedMotion(false);
    const b = render(<AnimatedNumber value={80} suffix="%" />);
    expect(b.container.querySelector("span")!.getAttribute("aria-label")).toBe("80%");
  });

  it("ProgressBar 不确定态没有 aria-valuenow，流光 class 随进度出现", () => {
    const { container, rerender } = render(<ProgressBar value={40} />);
    expect(container.querySelector(".muster-progress-shine")).not.toBeNull();
    rerender(<ProgressBar value={100} />);
    expect(container.querySelector(".muster-progress-shine")).toBeNull();
    rerender(<ProgressBar value={0} indeterminate label="x" />);
    expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
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

  it("浮层触发器可渲染", () => {
    render(
      <div>
        <Tooltip content="提示" shortcut="Ctrl+B"><Button>悬停</Button></Tooltip>
        <Dialog>
          <DialogTrigger asChild><Button>开窗</Button></DialogTrigger>
          <DialogContent title="标题" description="描述">体</DialogContent>
        </Dialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button>菜单</Button></DropdownMenuTrigger>
          <DropdownMenuContent><DropdownMenuItem>项</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>,
    );
    expect(screen.getByText("悬停")).toBeTruthy();
    expect(screen.getByText("开窗")).toBeTruthy();
    expect(screen.getByText("菜单")).toBeTruthy();
  });

  it("Sheet 打开后显示标题、内容与底部操作", () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="成员详情" description="说明" footer={<Button>保存</Button>}>
          抽屉内容
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("成员详情")).toBeTruthy();
    expect(screen.getByText("抽屉内容")).toBeTruthy();
    expect(screen.getByText("保存")).toBeTruthy();
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
    const custom = await screen.findByText("my-model");
    fireEvent.click(custom);
    expect(onChange).toHaveBeenCalledWith("my-model");
  });

  it("CommandPalette 列出分组项并在选中后触发 onSelect", async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        items={[
          { id: "home", label: "主线", group: "页面", onSelect },
          { id: "bot", label: "小码", group: "成员", pebble: { status: "working" }, onSelect: () => {} },
        ]}
      />,
    );
    expect(screen.getByText("页面")).toBeTruthy();
    expect(screen.getByText("成员")).toBeTruthy();
    fireEvent.click(screen.getByText("主线"));
    expect(onSelect).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

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

  it("UiGallery 渲染 35 个矩阵吉祥物", () => {
    const { container } = render(<UiGallery />);
    expect(container.querySelectorAll("table svg[data-status]").length).toBe(35);
  });
});
