// OWNER: W1. WebSocket 客户端：请求/响应关联、请求超时、断线时请求立即失败、
// 指数退避自动重连（重连成功后 hub.ts 在 status 变 "open" 时重新拉 snapshot）。
import type { MethodName, Methods, ServerMessage, WirePush, WireRequest } from "@muster/protocol";
import type { MusterClient } from "@muster/protocol/client";

export interface WsClientOptions {
  /** 单个请求的超时（毫秒），默认 15000。 */
  timeoutMs?: number;
  /** 重连退避上限（毫秒），默认 5000。 */
  maxBackoffMs?: number;
  /** 注入 WebSocket 实现（测试用），默认全局 WebSocket。 */
  WebSocketImpl?: typeof WebSocket;
}

interface Pending {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createWsClient(url: string, token?: string, opts: WsClientOptions = {}): MusterClient {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 5_000;
  const WS = opts.WebSocketImpl ?? WebSocket;

  const pushHandlers = new Set<(p: WirePush) => void>();
  const statusHandlers = new Set<(s: "connecting" | "open" | "closed") => void>();
  const pending = new Map<string, Pending>();
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let attempt = 0;
  let nextId = 1;
  const setStatus = (s: "connecting" | "open" | "closed") => statusHandlers.forEach((h) => h(s));

  const failAll = (reason: string) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  };

  const connect = () => {
    reconnectTimer = undefined;
    if (closed) return;
    setStatus("connecting");
    const target = token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
    let sock: WebSocket;
    try {
      sock = new WS(target);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      attempt = 0;
      setStatus("open");
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      let m: ServerMessage;
      try {
        m = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return; // 忽略无法解析的帧
      }
      if (m.type === "push") {
        pushHandlers.forEach((h) => h(m));
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result as never);
      else p.reject(new Error(`${m.error.code}: ${m.error.message}`));
    };
    sock.onclose = () => {
      if (ws !== sock) return; // 已被替换的旧连接
      ws = null;
      setStatus("closed");
      failAll("connection closed");
      scheduleReconnect();
    };
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        /* 已关闭 */
      }
    };
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(connect, Math.min(maxBackoffMs, 300 * 2 ** attempt++));
  };

  connect();

  return {
    request<M extends MethodName>(method: M, params: Methods[M]["params"]) {
      return new Promise<Methods[M]["result"]>((resolve, reject) => {
        const sock = ws;
        if (closed || !sock || sock.readyState !== WS.OPEN) return reject(new Error("not connected"));
        const id = String(nextId++);
        const timer = setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`timeout: ${method} 超过 ${timeoutMs / 1000}s 未响应`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (v: never) => void, reject, timer });
        const req: WireRequest<M> = { type: "req", id, method, params };
        try {
          sock.send(JSON.stringify(req));
        } catch (e) {
          pending.delete(id);
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    onPush(h) {
      pushHandlers.add(h);
      return () => pushHandlers.delete(h);
    },
    onStatus(h) {
      statusHandlers.add(h);
      return () => statusHandlers.delete(h);
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(reconnectTimer);
      failAll("client closed");
      const sock = ws;
      ws = null;
      try {
        sock?.close();
      } catch {
        /* 已关闭 */
      }
      setStatus("closed");
    },
  };
}
