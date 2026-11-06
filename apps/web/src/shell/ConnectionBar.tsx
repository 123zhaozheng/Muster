// OWNER: U2. 连接横幅：未连接（正在连接/重连中）或已断开时出现，带“立即重试”；open 后消失。
import { useEffect, useRef, useState } from "react";
import { Loader, RotateCw, WifiOff } from "lucide-react";
import { Button, cn } from "@muster/ui";
import { useHub } from "../lib/hub";
import { retryConnection } from "../lib/retry";

export function ConnectionBar() {
  const status = useHub((s) => s.status);
  const hadOpen = useRef(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (status === "open") hadOpen.current = true;
    setRetrying(false);
  }, [status]);

  if (status === "open") return null;
  const closed = status === "closed";
  const text = closed ? "连接已断开，正在自动重连…" : hadOpen.current ? "正在重新连接守护进程…" : "正在连接守护进程…";
  return (
    <div
      role="status"
      className={cn(
        "muster-banner flex min-h-9 shrink-0 items-center justify-center gap-3 px-4 py-1 text-[13px] font-medium",
        closed ? "bg-danger-soft text-danger" : "bg-amber-soft text-amber",
      )}
    >
      <span className="flex items-center gap-1.5">
        {closed ? <WifiOff size={15} /> : <Loader size={15} className="animate-spin" />}
        {text}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 bg-white/80 px-3 text-xs"
        disabled={retrying}
        icon={<RotateCw size={13} className={retrying ? "animate-spin" : undefined} />}
        onClick={() => {
          setRetrying(true);
          retryConnection();
        }}
      >
        {retrying ? "重试中…" : "立即重试"}
      </Button>
    </div>
  );
}
