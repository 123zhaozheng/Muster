// 复制按钮：复制成功后图标变成对勾，并弹 Toast。
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn, toast } from "@muster/ui";

export function CopyButton({ text, label = "复制", className, dark }: { text: string; label?: string; className?: string; dark?: boolean }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    const ok = () => {
      setDone(true);
      toast.success("已复制");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1400);
    };
    const nav = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (nav?.writeText) nav.writeText(text).then(ok, () => toast.error("复制失败"));
    else toast.error("当前环境不支持复制");
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={copy}
      className={cn(
        "inline-grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg transition-[background-color,color,transform] duration-150 ease-muster active:scale-90",
        dark ? "text-[#b8aca2] hover:bg-white/10 hover:text-white" : "text-ink-faint hover:bg-canvas-deep hover:text-ink",
        done && (dark ? "text-mint" : "text-mint-deep"),
        className,
      )}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
