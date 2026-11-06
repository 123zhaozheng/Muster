// OWNER: B1. WebSocket + /health server over the hub (127.0.0.1 only).
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { MethodName, WirePush, WireResponse } from "@muster/protocol";
import type { Handlers, Hub } from "../core/contracts";
import { HandlerError, toWireError } from "../handlers/errors";

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const MAX_PAYLOAD = 8 * 1024 * 1024;

export async function startServer(o: { hub: Hub; handlers: Handlers; port: number; token?: string }): Promise<RunningServer> {
  const { hub, handlers, token } = o;

  const http = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  http.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const authorized = !token || url.searchParams.get("token") === token;
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!authorized) ws.close(4401, "unauthorized");
      else wss.emit("connection", ws, req);
    });
  });

  const send = (ws: WebSocket, msg: WireResponse | WirePush) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const respond = async (raw: string): Promise<WireResponse | undefined> => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return { type: "res", id: "", ok: false, error: { code: "bad_request", message: "不是合法的 JSON" } };
    }
    const req = msg as { type?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
    if (!req || typeof req !== "object" || req.type !== "req" || typeof req.id !== "string" || typeof req.method !== "string") {
      return { type: "res", id: typeof req?.id === "string" ? req.id : "", ok: false, error: { code: "bad_request", message: "请求格式应为 {type:'req', id, method, params}" } };
    }
    const id = req.id;
    const params = req.params ?? {};
    if (typeof params !== "object" || Array.isArray(params)) {
      return { type: "res", id, ok: false, error: { code: "bad_request", message: "params 必须是对象" } };
    }
    const handler = Object.hasOwn(handlers, req.method) ? (handlers[req.method as MethodName] as ((p: unknown) => Promise<unknown>) | undefined) : undefined;
    if (!handler) return { type: "res", id, ok: false, error: { code: "unsupported", message: `不支持的方法：${req.method}` } };
    try {
      return { type: "res", id, ok: true, result: await handler(params) };
    } catch (e) {
      const error = toWireError(e);
      if (error.code === "internal" && !(e instanceof HandlerError)) console.error(`[server] ${req.method} failed`, e);
      return { type: "res", id, ok: false, error };
    }
  };

  wss.on("connection", (ws) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      void respond(data.toString()).then((res) => res && send(ws, res));
    });
    ws.on("error", () => ws.terminate());
  });

  const unsubscribe = hub.subscribe((push) => {
    const text = JSON.stringify(push);
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(o.port, "127.0.0.1", () => {
      http.off("error", reject);
      resolve();
    });
  });

  let closing: Promise<void> | undefined;
  return {
    port: (http.address() as AddressInfo).port,
    close() {
      closing ??= (async () => {
        unsubscribe();
        for (const ws of wss.clients) ws.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
      })();
      return closing;
    },
  };
}
