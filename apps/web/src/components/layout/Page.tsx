// OWNER: U2. 页面布局原语：<Page> / <PageHeader> / <PageBody> / <PageGrid>。所有页面都应使用，保证宽度、边距、光晕、节奏一致。
//
// 用法示例（页面开发者照抄即可）：
//
//   export default function Crew() {
//     return (
//       <Page>
//         <PageHeader title="团队" subtitle="你的成员与它们的状态" actions={<Button variant="primary">新建成员</Button>} />
//         <StatRow />                                           // 概览区：统计卡 / Hero，自己排版
//         <PageBody
//           main={
//             <PageGrid min={300}>                              // 响应式卡片网格，子元素依次淡入
//               {bots.map((b) => <CrewCard key={b.id} bot={b} />)}
//             </PageGrid>
//           }
//           rail={<>                                            // 右栏：宽屏固定 340~380px；窄屏下沉到主区下方；没有就不传
//             <Card>…进行中…</Card>
//             <Card>…需要你…</Card>
//           </>}
//         />
//       </Page>
//     );
//   }
//
// 约定：
//  - 外壳（Shell）已经负责路由过渡动画与滚动，页面根节点直接返回 <Page>，不要再自己加 h-full / overflow。
//  - 区块之间的竖向间距由 <Page> 提供（gap-6）；卡片之间 gap-5（<PageGrid>）。
//  - 需要整页占满高度的页面（如聊天工作台）用 <Page fill>：去掉竖向 padding 并让内容区至少占满可视高度。
//  - 右栏响应的是“内容区宽度”（容器查询），所以侧栏收起/展开时布局会自动适配。
import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@muster/ui";
import "./layout.css";

/* ───────────────────────── Page ───────────────────────── */

export interface PageProps extends HTMLAttributes<HTMLDivElement> {
  /** 去掉竖向 padding，并让内容区至少占满可视高度（工作台这类“应用式”页面）。 */
  fill?: boolean;
  /** 关闭顶部渐变光晕。 */
  noGlow?: boolean;
}

/** 统一页面容器：最大宽 1680 居中，水平边距 32（窄屏 20），顶部渐变光晕，区块间距 24。 */
export function Page({ fill, noGlow, className, children, ...rest }: PageProps) {
  return (
    <div className="relative min-h-full w-full" data-muster-page>
      {!noGlow && <div aria-hidden className="muster-page-halo pointer-events-none absolute inset-x-0 top-0 h-[360px]" />}
      <div
        className={cn(
          "relative mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-5 md:px-8",
          fill ? "min-h-full py-4" : "py-6 md:py-8",
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

/* ───────────────────────── PageHeader ───────────────────────── */

export interface PageHeaderProps {
  title: ReactNode;
  /** 一句话副标题。 */
  subtitle?: ReactNode;
  /** 标题左侧的图标 / 吉祥物。 */
  leading?: ReactNode;
  /** 右侧主操作区（按钮们）。 */
  actions?: ReactNode;
  className?: string;
}

/** 页面标题行：大标题 28/34 + 副标题 + 右侧主操作。 */
export function PageHeader({ title, subtitle, leading, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-3", className)}>
      <div className="flex min-w-0 items-center gap-4">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-[34px] tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm leading-[22px] text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

/* ───────────────────────── PageBody ───────────────────────── */

export interface PageBodyProps {
  /** 主区：自适应宽度。 */
  main: ReactNode;
  /** 右栏（可选）：宽屏固定 railWidth，窄屏下沉到主区下方（并排成两列）。 */
  rail?: ReactNode;
  /** 右栏宽度，限制在 340~380，默认 360。 */
  railWidth?: number;
  className?: string;
  mainClassName?: string;
  railClassName?: string;
}

/** 主区 + 可选右栏。右栏出现的条件是容器宽度 ≥ 1024px（不是视口宽度），所以对侧栏收起/展开自适应。 */
export function PageBody({ main, rail, railWidth = 360, className, mainClassName, railClassName }: PageBodyProps) {
  const style = { "--muster-rail": `${Math.min(380, Math.max(340, railWidth))}px` } as CSSProperties;
  return (
    <div className={cn("@container min-w-0", className)}>
      <div style={style} className={cn("grid items-start gap-6", rail && "@5xl:grid-cols-[minmax(0,1fr)_var(--muster-rail)]")}>
        <div className={cn("flex min-w-0 flex-col gap-6", mainClassName)}>{main}</div>
        {rail && <aside className={cn("grid min-w-0 content-start gap-5 @2xl:grid-cols-2 @5xl:grid-cols-1", railClassName)}>{rail}</aside>}
      </div>
    </div>
  );
}

/* ───────────────────────── PageGrid ───────────────────────── */

export interface PageGridProps extends HTMLAttributes<HTMLElement> {
  /** 单个卡片的最小宽度（px），默认 280。列数随容器宽度自动变化。 */
  min?: number;
  /** 空列折叠（auto-fit）。数据很少时想让卡片拉宽填满一行就开。 */
  stretch?: boolean;
  /** 渲染成其他标签，例如 "ul"。 */
  as?: ElementType;
}

/** 响应式卡片网格：gap 20，子元素进入时依次出现。 */
export function PageGrid({ min = 280, stretch, as, className, style, children, ...rest }: PageGridProps) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      className={cn("muster-stagger grid gap-5", className)}
      style={{ gridTemplateColumns: `repeat(${stretch ? "auto-fit" : "auto-fill"}, minmax(min(100%, ${min}px), 1fr))`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
