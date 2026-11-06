import { vi } from "vitest";
import type { MethodName, Methods } from "@muster/protocol";
import { snapshot } from "@muster/protocol/fixtures";
import { modelFromSnapshot } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { useHub } from "../../lib/hub";

type Handlers = { [M in MethodName]?: (params: Methods[M]["params"]) => Methods[M]["result"] | Promise<Methods[M]["result"]> };

/** Test helper: point the hub store at a fake client + fixtures, return the request spy. */
export function setupHub(handlers: Handlers = {}) {
  const request = vi.fn(async (method: MethodName, params: unknown) => {
    const h = handlers[method] as ((p: unknown) => unknown) | undefined;
    if (!h) throw new Error(`no handler for ${method}`);
    return h(params);
  });
  const client: MusterClient = {
    request: request as unknown as MusterClient["request"],
    onPush: () => () => undefined,
    onStatus: () => () => undefined,
    close() {},
  };
  useHub.setState({ client, status: "open", model: modelFromSnapshot(structuredClone(snapshot)), loadedThreads: {} });
  return request;
}
