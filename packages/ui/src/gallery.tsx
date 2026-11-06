import { useState } from "react";
import type { BotColor, BotStatus, PebbleShape } from "@muster/protocol";
import { Bell, Cpu, DollarSign, Plus, Search, Settings, Trash2, Users, Zap } from "lucide-react";
import { Pebble, STATUS_LABEL } from "./Pebble";
import { Badge, Button, Card, Chip, CountBadge, Dot, Pulse, Segmented, StatusPill, type ChipTone } from "./basics";
import { Field, Input, Slider, Switch, Textarea } from "./forms";
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  ScrollArea, Sheet, SheetContent, SheetTrigger, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip,
} from "./overlays";
import { AnimatedNumber, AvatarGroup, Empty, Kbd, ProgressBar, Skeleton, SkeletonText } from "./display";
import { AvatarStack, DescriptionList, PageHeader, Section, StatCard } from "./layout";
import { ConfirmDialog, IconButton } from "./controls";
import { Combobox, CommandPalette, Select } from "./select";
import { toast, Toaster } from "./toast";

const SHAPES: PebbleShape[] = ["round", "square", "blob", "egg", "flat"];
const STATUSES: BotStatus[] = ["idle", "thinking", "working", "waiting_approval", "done", "error", "sleeping"];
const COLORS: BotColor[] = ["cream", "mint", "peach", "sky", "lilac", "rose", "butter"];
const SIZES = [16, 24, 32, 48, 80, 120, 200];
const TONES: ChipTone[] = ["neutral", "coral", "lavender", "mint", "amber", "sky", "danger"];
const ROSTER = [
  { id: "pip", name: "Pip", shape: "round", color: "cream", status: "idle" },
  { id: "xm", name: "小码", shape: "square", color: "mint", status: "working" },
  { id: "ak", name: "阿克", shape: "blob", color: "peach", status: "waiting_approval" },
  { id: "xt", name: "小探", shape: "egg", color: "sky", status: "sleeping" },
  { id: "xw", name: "小文", shape: "flat", color: "lilac", status: "done" },
] as const;
const MODELS = [
  { value: "gpt-5", label: "gpt-5", description: "OpenAI" },
  { value: "claude-sonnet-4-5", label: "claude-sonnet-4-5", description: "Anthropic" },
  { value: "deepseek-chat", label: "deepseek-chat", description: "DeepSeek" },
  { value: "qwen3-max", label: "qwen3-max", description: "Qwen" },
];

/** Eyeball-check page for every @muster/ui component and the mascot matrix (mounted from the settings page). */
export function UiGallery() {
  const [seg, setSeg] = useState("a");
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(40);
  const [live, setLive] = useState<BotStatus>("idle");
  const [mood, setMood] = useState<"calm" | "normal" | "lively">("normal");
  const [halo, setHalo] = useState(true);
  const [model, setModel] = useState("gpt-5");
  const [sel, setSel] = useState("a");
  const [palette, setPalette] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [n, setN] = useState(1280);

  return (
    <div className="muster-page-glow space-y-8 p-2" data-testid="ui-gallery">
      <PageHeader
        title="设计系统 v2"
        subtitle="所有组件与会动的 Pebble 一览，用来肉眼检查质感"
        pebble={{ status: "done" }}
        actions={
          <>
            <Button variant="outline" icon={<Search className="size-4" />} onClick={() => setPalette(true)}>
              命令面板 <Kbd>Ctrl K</Kbd>
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => toast.success({ title: "已保存", description: "这是一条 Toast" })}>
              弹个 Toast
            </Button>
          </>
        }
      />

      <Section title="吉祥物 · 5 形状 x 7 状态" description="全部持续动画；hover 看眼睛跟随，点一下弹跳" card>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-x-3 border-spacing-y-2 text-center text-xs text-ink-soft">
            <thead>
              <tr>
                <th />
                {STATUSES.map((s) => (
                  <th key={s} className="font-medium">{STATUS_LABEL[s]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHAPES.map((shape, i) => (
                <tr key={shape}>
                  <th className="pr-2 text-left font-medium">{shape}</th>
                  {STATUSES.map((status) => (
                    <td key={status}>
                      <Pebble shape={shape} status={status} color={COLORS[i % COLORS.length]} size={72} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-6 rounded-2xl bg-canvas p-5">
          <Pebble shape="round" status={live} size={160} halo={halo} mood={mood} />
          <div className="space-y-3">
            <div className="text-sm font-medium text-ink">状态切换（squash &amp; stretch）</div>
            <Segmented value={live} onChange={setLive} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} className="flex-wrap" />
            <div className="flex flex-wrap items-center gap-4 text-sm text-ink-soft">
              <Segmented value={mood} onChange={setMood} options={[{ value: "calm", label: "平静" }, { value: "normal", label: "正常" }, { value: "lively", label: "活泼" }]} />
              <label className="flex items-center gap-2"><Switch checked={halo} onCheckedChange={setHalo} aria-label="光环" /> 光环</label>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          {SIZES.map((s) => (
            <div key={s} className="flex flex-col items-center gap-1 text-xs text-ink-faint">
              <Pebble size={s} />
              {s}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {COLORS.map((c) => (
            <Pebble key={c} color={c} size={48} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <AvatarGroup bots={ROSTER.map((b) => ({ ...b }))} />
          <AvatarGroup bots={ROSTER.map((b) => ({ ...b }))} max={3} size={36} />
          <AvatarStack items={ROSTER.map((b) => ({ ...b }))} />
          <div className="flex items-center gap-1" aria-label="lite 列表头像">
            {Array.from({ length: 30 }, (_, i) => (
              <Pebble key={i} lite size={22} shape={SHAPES[i % 5]} color={COLORS[i % 7]} status={STATUSES[i % 7]} />
            ))}
          </div>
        </div>
      </Section>

      <Section title="概览 · StatCard" description="数字滚动、趋势、sparkline" actions={<Button size="sm" variant="soft" onClick={() => setN((v) => v + 317)}>数值 +317</Button>}>
        <div className="muster-stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="进行中任务" value={n} icon={<Zap />} tone="coral" trend={{ value: 12.4, label: "较上周" }} sparkline={[3, 5, 4, 8, 6, 9, 12]} />
          <StatCard label="本周花费" value={18.62} prefix="$" decimals={2} icon={<DollarSign />} tone="amber" trend={{ value: 8, inverse: true, label: "较上周" }} sparkline={[2, 3, 3, 5, 4, 6, 7]} />
          <StatCard label="在线成员" value={5} icon={<Users />} tone="mint" hint="全部在线" />
          <StatCard label="模型调用" value="—" icon={<Cpu />} tone="lavender" loading />
        </div>
      </Section>

      <Section title="按钮 / 标签 / 分段" card>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">主要</Button>
          <Button variant="soft">柔和</Button>
          <Button variant="outline">描边</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />}>危险</Button>
          <Button variant="primary" loading>加载中</Button>
          <Button variant="primary" disabled>禁用</Button>
          <IconButton label="设置" shortcut="Ctrl+," variant="outline"><Settings /></IconButton>
          <IconButton label="通知" variant="soft" badge={<CountBadge count={3} />}><Bell /></IconButton>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {TONES.map((t) => (
            <Chip key={t} tone={t}>{t}</Chip>
          ))}
          {TONES.map((t) => (
            <Badge key={`b${t}`} tone={t} variant="outline" dot>{t}</Badge>
          ))}
          {STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-ink-soft">
          <Dot tone="mint" /> <Pulse tone="coral" /> <Pulse status="waiting_approval" size={10} /> <CountBadge count={128} /> <CountBadge count={2} dot />
          <Badge tone="coral" variant="solid" size="sm">NEW</Badge>
        </div>
        <Segmented
          className="mt-4"
          value={seg}
          onChange={setSeg}
          options={[{ value: "a", label: "全部" }, { value: "b", label: "进行中" }, { value: "c", label: "已完成" }]}
        />
      </Section>

      <Section title="表单 / 选择" card>
        <div className="grid max-w-xl gap-4">
          <Field label="名称" hint="给成员起个名字" required>
            <Input placeholder="输入框" />
          </Field>
          <Field label="邮箱" error="格式不正确">
            <Input placeholder="校验失败" aria-invalid defaultValue="abc" />
          </Field>
          <Field label="人设">
            <Textarea placeholder="多行输入" />
          </Field>
          <Field label="类型">
            <Select
              value={sel}
              onValueChange={setSel}
              options={[
                { value: "a", label: "原生成员", description: "跑在 pi-durable 上", group: "内置" },
                { value: "b", label: "Claude Code", group: "外部" },
                { value: "c", label: "Codex", group: "外部" },
              ]}
            />
          </Field>
          <Field label="模型" hint="可搜索，也可以直接输入自定义模型 ID">
            <Combobox options={MODELS} value={model} onValueChange={setModel} allowCustom clearable />
          </Field>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={on} onCheckedChange={setOn} aria-label="开关" />
            {on ? "已开启" : "已关闭"}
          </label>
          <div className="flex items-center gap-3 text-sm">
            <Slider value={vol} onValueChange={setVol} aria-label="滑块" />
            <span className="w-8 text-right tabular-nums"><AnimatedNumber value={vol} animateOnMount={false} duration={0.3} /></span>
          </div>
          <ProgressBar value={vol} label="进度" />
          <ProgressBar value={72} tone="mint" size="lg" />
          <ProgressBar value={30} tone="amber" size="sm" />
          <ProgressBar value={0} indeterminate label="不确定进度" />
        </div>
      </Section>

      <Section title="标签页 / 滚动 / 键位 / 详情" card>
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">概览</TabsTrigger>
            <TabsTrigger value="two">日志</TabsTrigger>
            <TabsTrigger value="three">设置</TabsTrigger>
          </TabsList>
          <TabsContent value="one">概览内容</TabsContent>
          <TabsContent value="two">
            <ScrollArea className="h-24 rounded-2xl border border-line">
              <div className="space-y-1 p-3 text-sm text-ink-soft">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i}>第 {i + 1} 行日志</div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="three">设置内容</TabsContent>
        </Tabs>
        <Tabs defaultValue="x" className="mt-6">
          <TabsList variant="line">
            <TabsTrigger value="x">成员</TabsTrigger>
            <TabsTrigger value="y">技能</TabsTrigger>
          </TabsList>
          <TabsContent value="x">下划线风格</TabsContent>
          <TabsContent value="y">技能内容</TabsContent>
        </Tabs>
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
          发送 <Kbd>Enter</Kbd> 换行 <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>
        </div>
        <DescriptionList
          className="mt-5"
          items={[
            { label: "成员 ID", value: "bot_8f3a21", mono: true, copyable: true },
            { label: "模型", value: "claude-sonnet-4-5", mono: true },
            { label: "状态", value: <StatusPill status="working" /> },
            { label: "本周花费", value: "$1.24" },
          ]}
        />
      </Section>

      <Section title="浮层 / 反馈" card>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip content="这是一个提示" shortcut="Ctrl+B">
            <Button variant="outline">悬停看提示</Button>
          </Tooltip>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="soft">打开对话框</Button>
            </DialogTrigger>
            <DialogContent title="确认操作" description="这是一个对话框示例。">
              <Input placeholder="名称" />
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">取消</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="primary">确定</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="soft">右侧抽屉</Button>
            </SheetTrigger>
            <SheetContent title="成员详情" description="Sheet 示例" footer={<Button variant="primary">保存</Button>}>
              <SkeletonText lines={4} />
            </SheetContent>
          </Sheet>
          <Button variant="danger" onClick={() => setConfirm(true)}>二次确认</Button>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            tone="danger"
            title="删除这位成员？"
            description="删除后无法恢复。"
            confirmText="删除"
            onConfirm={() => new Promise<void>((r) => setTimeout(r, 800))}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" icon={<Settings className="size-4" />}>菜单</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>操作</DropdownMenuLabel>
              <DropdownMenuItem icon={<Plus className="size-4" />}>新建</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem danger icon={<Trash2 className="size-4" />}>删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => toast.error("出错了")}>错误 Toast</Button>
          <Button variant="outline" onClick={() => void toast.promise(new Promise((r) => setTimeout(r, 1200)), { loading: "保存中…", success: "保存成功", error: "失败" })}>Promise Toast</Button>
        </div>
        <div className="mt-5 grid max-w-md gap-3">
          <div className="flex items-center gap-3"><Skeleton circle className="size-10" /><Skeleton className="h-4 w-40" /></div>
          <SkeletonText />
        </div>
        <Card hoverable className="mt-5 max-w-xs p-5 text-sm text-ink-soft">hover 上浮的卡片</Card>
      </Section>

      <Section title="空状态" card>
        <Empty title="还没有任务" description="对 Pip 说一句话，就会有小伙伴来帮你。" action={<Button variant="primary">开始</Button>} />
      </Section>

      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        items={[
          { id: "home", label: "主线", group: "页面", icon: <Zap />, hint: "/" },
          { id: "crew", label: "团队", group: "页面", icon: <Users />, hint: "/crew" },
          ...ROSTER.map((b) => ({ id: b.id, label: b.name, group: "成员", pebble: { shape: b.shape, color: b.color, status: b.status }, onSelect: () => toast.info(b.name) })),
        ].map((it) => ({ onSelect: () => {}, ...it }))}
      />
      <Toaster />
    </div>
  );
}
