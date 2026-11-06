// Markdown 里的围栏代码块：语言标签、语法着色、复制。
import { Children, isValidElement, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { TOKEN_CLASS, highlightLine, langFamily } from "./highlight";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** 给 react-markdown 的 `pre` 组件用：从子 <code> 里取出语言和源码。 */
export function MarkdownPre({ children }: { children?: ReactNode }) {
  const code = Children.toArray(children)[0];
  const props = isValidElement<{ className?: string; children?: ReactNode }>(code) ? code.props : undefined;
  const lang = /language-([\w+-]+)/.exec(props?.className ?? "")?.[1];
  const source = textOf(props?.children ?? children).replace(/\n$/, "");
  return <CodeBlock code={source} lang={lang} />;
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const family = langFamily(lang);
  const lines = code.split("\n");
  return (
    <div className="my-2.5 overflow-hidden rounded-control border border-border bg-surface-muted" data-testid="code-block">
      <div className="flex items-center justify-between border-b border-border px-3 py-0.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-fg-3">{lang ?? "text"}</span>
        <CopyButton text={code} label="复制代码" />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-[1.65] text-fg">
        <code>
          {lines.map((line, i) => (
            <span key={i} className="block min-h-[1.65em] whitespace-pre">
              {highlightLine(line, family).map((t, j) => (
                <span key={j} className={TOKEN_CLASS[t.type]}>{t.text}</span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
