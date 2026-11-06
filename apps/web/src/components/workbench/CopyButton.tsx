// 复制按钮：复制成功后图标短暂变成对勾。
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton, toast } from "@muster/ui";

export function CopyButton({ text, label = "复制", className }: { text: string; label?: string; className?: string }) {
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
    <IconButton label={label} size="sm" className={className} onClick={copy}>
      {done ? <Check className="text-success" /> : <Copy />}
    </IconButton>
  );
}
