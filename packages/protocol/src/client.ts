/**
 * Client-side transport abstraction. The web app talks ONLY to this interface.
 *  - WsClient   : real daemon (implemented by the web agent in apps/web/src/lib/wsClient.ts)
 *  - MockClient : in-memory fixtures (apps/web/src/lib/mockClient.ts)
 */
import type { Methods, MethodName, PushPayload, WirePush } from "./index";

export interface MusterClient {
  request<M extends MethodName>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]>;
  /** Returns an unsubscribe function. Pushes are delivered in `seq` order. */
  onPush(handler: (push: WirePush) => void): () => void;
  onStatus(handler: (s: "connecting" | "open" | "closed") => void): () => void;
  close(): void;
}

export type { PushPayload };
