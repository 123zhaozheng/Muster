// 统一 diff 渲染：等宽字体、行号、绿增红删，并按文件类型做语法着色。长行只在自身区域横向滚动。
import { cn } from "@muster/ui";
import { TOKEN_CLASS, highlightLine, langFamily } from "./highlight";
import { parseUnifiedDiff, type DiffLine } from "./logic";

const LINE_BG: Record<DiffLine["type"], string> = {
  add: "bg-success-surface",
  del: "bg-danger-surface",
  ctx: "",
  hunk: "bg-accent-surface text-accent",
  meta: "text-fg-3",
};
const SIGN: Record<DiffLine["type"], string> = { add: "+", del: "−", ctx: " ", hunk: "", meta: "" };
const SIGN_COLOR: Record<DiffLine["type"], string> = { add: "text-success", del: "text-danger", ctx: "", hunk: "", meta: "" };

export function DiffView({ patch, path }: { patch: string; path?: string }) {
  const lines = parseUnifiedDiff(patch);
  if (lines.length === 0) return <div className="rounded-control bg-surface-muted p-4 text-center text-caption text-fg-3">没有可显示的改动</div>;
  const family = langFamily(undefined, path);
  return (
    <div className="overflow-x-auto rounded-control border border-border bg-surface py-1 font-mono text-[12.5px] leading-6" data-testid="diff-view">
      {lines.map((l, i) => (
        <div key={i} data-line={l.type} className={cn("flex min-w-max whitespace-pre", LINE_BG[l.type])}>
          <span className="w-10 shrink-0 select-none pr-2 text-right text-fg-3">{l.no ?? ""}</span>
          <span className={cn("w-5 shrink-0 select-none text-center", SIGN_COLOR[l.type])}>{SIGN[l.type]}</span>
          <span className="pr-3">
            {l.type === "add" || l.type === "del" || l.type === "ctx"
              ? highlightLine(l.text, family).map((t, j) => (
                  <span key={j} className={TOKEN_CLASS[t.type]}>{t.text}</span>
                ))
              : l.text}
          </span>
        </div>
      ))}
    </div>
  );
}
