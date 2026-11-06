// Connection banner: only shown while connecting / disconnected; disappears once the connection is open.
import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCw, WifiOff } from "lucide-react";
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
    <div role="status" className={cn("flex min-h-9 w-full items-center justify-center gap-3 px-4 py-1 text-caption font-medium", closed ? "bg-danger-surface text-danger" : "bg-warning-surface text-warning")}>
      <span className="flex items-center gap-1.5">
        {closed ? <WifiOff size={15} /> : <Loader2 size={15} className="animate-spin" />}
        {text}
      </span>
      <Button
        variant="secondary"
        size="sm"
        className="h-7 px-3 text-xs"
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
