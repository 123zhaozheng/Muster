// 测试辅助：把 fixtures 灌进 useHub，并注入可断言的假客户端。
import { vi } from "vitest";
import { snapshot, entriesByThread, tasks, branches } from "@muster/protocol/fixtures";
import { modelFromSnapshot } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { useHub } from "../../lib/hub";

export function seedHub(overrides?: (method: string, params: unknown) => unknown) {
  const request = vi.fn(async (method: string, params: unknown) => {
    const o = overrides?.(method, params);
    if (o !== undefined) return o;
    switch (method) {
      case "task.fork": return { task: tasks[2], branch: branches[1] };
      case "task.branches": return { branches: structuredClone(branches) };
      case "branch.adopt": return { branch: { ...branches[0], adopted: true } };
      case "chat.send": return { entryId: "e-new" };
      default: return { ok: true };
    }
  });
  const client = { request, onPush: () => () => {}, onStatus: () => () => {}, close() {} } as unknown as MusterClient;
  const model = { ...modelFromSnapshot(structuredClone(snapshot)), entries: structuredClone(entriesByThread) };
  const loadedThreads = Object.fromEntries(snapshot.threads.map((t) => [t.id, true as const]));
  useHub.setState({ model, client, status: "open", mock: true, loadedThreads });
  return request;
}
