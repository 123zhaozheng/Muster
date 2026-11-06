// Page-level layout primitives (docs/12 §2).
//   Page         management pages: centred, max 1200, padding 32 (40 on wide screens). The page renders its own PageHeader (from @muster/ui).
//   PageBody     main column + optional narrow right rail (stacks below the main column on narrow containers).
// Conversation pages use ChatLayout; master-detail pages use ListDetail.
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@muster/ui";

interface PageProps extends HTMLAttributes<HTMLDivElement> {
  /** Application-style page: full width, tighter vertical padding (e.g. the task workbench). */
  fill?: boolean;
}

/** Page container. The shell owns scrolling; a page just returns <Page>. */
export function Page({ fill, className, children, ...rest }: PageProps) {
  return (
    <div className="min-h-full w-full" data-muster-page>
      <div
        className={cn("mx-auto flex w-full flex-col gap-6 px-5 md:px-8 min-[1600px]:px-10", fill ? "min-h-full py-4" : "max-w-[1200px] py-6 md:py-8", className)}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

interface PageBodyProps {
  /** Main column. */
  main: ReactNode;
  /** Right rail (optional): fixed width on wide containers, below the main column on narrow ones. */
  rail?: ReactNode;
  /** Rail width in px, clamped to 280-360. Default 300. */
  railWidth?: number;
  className?: string;
  mainClassName?: string;
  railClassName?: string;
}

/** Main + optional rail. The rail appears when the *container* is at least 1024px wide, so it adapts to the sidebar state. */
export function PageBody({ main, rail, railWidth = 300, className, mainClassName, railClassName }: PageBodyProps) {
  const style = { "--muster-rail": `${Math.min(360, Math.max(280, railWidth))}px` } as CSSProperties;
  return (
    <div className={cn("@container min-w-0", className)}>
      <div style={style} className={cn("grid items-start gap-6", rail && "@5xl:grid-cols-[minmax(0,1fr)_var(--muster-rail)]")}>
        <div className={cn("flex min-w-0 flex-col gap-6", mainClassName)}>{main}</div>
        {rail && <aside className={cn("grid min-w-0 content-start gap-5 @2xl:grid-cols-2 @5xl:grid-cols-1", railClassName)}>{rail}</aside>}
      </div>
    </div>
  );
}
