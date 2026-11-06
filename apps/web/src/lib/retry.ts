// OWNER: U2. 连接“重试”：优先调用 client.reconnect()（若传输层提供），否则刷新页面重新建立连接。
// （MusterClient 契约没有 reconnect；wsClient 自带指数退避重连，这里是给用户的“立即重试”。）
import type { MusterClient } from "@muster/protocol/client";
import { useHub } from "./hub";

export function retryConnection(): void {
  const client = useHub.getState().client as (MusterClient & { reconnect?: () => void }) | null;
  if (client && typeof client.reconnect === "function") {
    client.reconnect();
    return;
  }
  if (typeof window !== "undefined") window.location.reload();
}
