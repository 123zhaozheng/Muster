// 仅供 W5 页面测试使用：用 fixtures 灌入 useHub，并提供可断言的假 client。
import { vi } from "vitest";
import type { DetectedAgent, MethodName } from "@muster/protocol";
import { snapshot } from "@muster/protocol/fixtures";
import { modelFromSnapshot } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { useHub } from "../../lib/hub";

export const agents: DetectedAgent[] = [
  { engine: "codex", command: "codex", version: "0.1.0", found: true },
  { engine: "claude", command: "claude", found: false },
];

/** 返回被监听的 request 函数。 */
export function setupHub(): ReturnType<typeof vi.fn> {
  const request = vi.fn(async (method: MethodName) => {
    if (method === "bot.detectAgents") return { agents };
    return {};
  });
  const client = { request, onPush: () => () => undefined, onStatus: () => () => undefined, close: () => undefined } as unknown as MusterClient;
  localStorage.clear();
  useHub.setState({ model: modelFromSnapshot(structuredClone(snapshot)), status: "open", client, mock: false, loadedThreads: {} });
  return request;
}
