// 统一 diff 渲染：等宽字体、行号、绿增红删，并按文件类型做语法着色。
import { cn } from "@muster/ui";
import { TOKEN_CLASS, highlightLine, langFamily } from "./highlight";
import { parseUnifiedDiff, type DiffLine } from "./logic";

const LINE_BG: Record<DiffLine["type"], string> = {
  add: "bg-mint-soft/80",
  del: "bg-danger-soft/80",
  ctx: "",
  hunk: "bg-sky-soft/60 text-sky-deep",
  meta: "text-ink-faint",
};
const SIGN: Record<DiffLine["type"], string> = { add: "+", del: "−", ctx: " ", hunk: "", meta: "" };
const SIGN_COLOR: Record<DiffLine["type"], string> = { add: "text-mint-deep", del: "text-danger-deep", ctx: "", hunk: "", meta: "" };
const GUTTER: Record<DiffLine["type"], string> = { add: "border-mint", del: "border-danger", ctx: "border-transparent", hunk: "border-sky", meta: "border-transparent" };

export function DiffView({ patch, path }: { patch: string; path?: string }) {
  const lines = parseUnifiedDiff(patch);
  if (lines.length === 0) return <div className="rounded-xl bg-canvas-deep/60 p-4 text-center text-xs text-ink-faint">没有可显示的改动</div>;
  const family = langFamily(undefined, path);
  return (
    <div className="wb-scroll overflow-x-auto rounded-xl border border-line bg-surface py-1 font-mono text-[12.5px] leading-6" data-testid="diff-view">
      {lines.map((l, i) => (
        <div key={i} data-line={l.type} className={cn("flex min-w-max whitespace-pre border-l-2", LINE_BG[l.type], GUTTER[l.type])}>
          <span className="w-10 shrink-0 select-none pr-2 text-right text-ink-faint">{l.no ?? ""}</span>
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
