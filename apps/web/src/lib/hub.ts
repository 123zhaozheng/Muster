// Shell data layer. Contract below is FROZEN; internals can be improved.
//
//   useHub(selector)        zustand hook over the shared HubModel (same reducer as the daemon)
//   useEntries(threadId)    entries of a thread (triggers a one-time thread.get load)
//   hubRequest(method, p)   typed request via the active MusterClient
//   startHub()              called once from main.tsx: picks the client and wires snapshot + pushes
//
// Client selection: `?mock=1` in the URL (or localStorage muster.mock=1) -> MockClient, else WsClient
// to ws://127.0.0.1:7788/ws (override with `?daemon=ws://host:port/ws&token=...`).
//
// 同步协议：status 变 "open" 即拉 snapshot；拉取期间收到的 push 先缓冲，snapshot 落地后按 seq 重放；
// 运行中若发现 seq 不连续（丢包）则重新拉 snapshot。已被 snapshot 覆盖的 push（seq <= model.seq）直接丢弃。
import { useEffect } from "react";
import { create } from "zustand";
import type { Branch, Entry, MethodName, Methods, TaskId, ThreadId, WirePush } from "@muster/protocol";
import { applyPush, emptyModel, mergeEntries, modelFromSnapshot, type HubModel } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { createMockClient } from "./mockClient";
import { createWsClient } from "./wsClient";

export type ConnStatus = "connecting" | "open" | "closed";

interface HubStore {
  model: HubModel;
  status: ConnStatus;
  client: MusterClient | null;
  mock: boolean;
  loadedThreads: Record<ThreadId, true>;
}

export const useHub = create<HubStore>(() => ({
  model: emptyModel(),
  status: "connecting",
  client: null,
  mock: false,
  loadedThreads: {},
}));

export function hubRequest<M extends MethodName>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]> {
  const c = useHub.getState().client;
  if (!c) return Promise.reject(new Error("not connected"));
  return c.request(method, params);
}

const NO_ENTRIES: Entry[] = [];
export function useEntries(threadId: ThreadId | undefined): Entry[] {
  const entries = useHub((s) => (threadId ? s.model.entries[threadId] : undefined)) ?? NO_ENTRIES;
  const status = useHub((s) => s.status);
  const loaded = useHub((s) => (threadId ? s.loadedThreads[threadId] : true));
  useEffect(() => {
    if (!threadId || loaded || status !== "open") return;
    useHub.setState((s) => ({ loadedThreads: { ...s.loadedThreads, [threadId]: true } }));
    hubRequest("thread.get", { threadId, limit: 500 })
      .then((r) => useHub.setState((s) => ({ model: mergeEntries(s.model, threadId, r.entries) })))
      .catch(() => useHub.setState((s) => {
        const { [threadId]: _x, ...rest } = s.loadedThreads;
        return { loadedThreads: rest };
      }));
  }, [threadId, loaded, status]);
  return entries;
}

/** 拉取某任务所属分支家族的全部 Branch 并并入 model.branches（snapshot 不含分支）。 */
export async function loadBranches(taskId: TaskId): Promise<Branch[]> {
  const { branches } = await hubRequest("task.branches", { taskId });
  useHub.setState((s) => ({ model: { ...s.model, branches: { ...s.model.branches, ...Object.fromEntries(branches.map((b) => [b.id, b])) } } }));
  return branches;
}

const MAX_RESYNC = 3;

/** 把一个 client 接到 store 上：状态、snapshot、push。返回解除函数。startHub 与测试共用。 */
export function attachClient(client: MusterClient, mock = false): () => void {
  useHub.setState({ client, mock });
  let syncing = false;
  let again = false;
  let buffer: WirePush[] = [];

  const sync = async (): Promise<void> => {
    if (syncing) {
      again = true;
      return;
    }
    syncing = true;
    buffer = [];
    try {
      for (let round = 0; round < MAX_RESYNC; round++) {
        again = false;
        const snap = await client.request("hub.snapshot", {});
        const pending = buffer.sort((a, b) => a.seq - b.seq);
        buffer = [];
        useHub.setState((s) => {
          let model = modelFromSnapshot(snap, s.model);
          for (const p of pending) {
            if (p.seq <= model.seq) continue;
            if (p.seq !== model.seq + 1) {
              again = true; // 缓冲里也有缺口，再拉一次
              break;
            }
            model = { ...applyPush(model, p.push), seq: p.seq };
          }
          return { model, loadedThreads: {} };
        });
        if (!again) break;
      }
    } catch {
      // 请求失败（多半是断线）：等下一次 "open" 再同步
    } finally {
      syncing = false;
    }
    // 分支不在 snapshot 里：为有分叉的任务预取一次
    const { tasks } = useHub.getState().model;
    const sources = new Set(Object.values(tasks).flatMap((t) => (t.forkedFrom ? [t.forkedFrom.taskId] : [])));
    await Promise.all([...sources].map((id) => loadBranches(id).catch(() => undefined)));
  };

  const offStatus = client.onStatus((status) => {
    useHub.setState({ status });
    if (status === "open") void sync();
  });
  const offPush = client.onPush((p) => {
    if (syncing) {
      buffer.push(p);
      return;
    }
    const cur = useHub.getState().model.seq;
    if (p.seq <= cur) return; // 已包含在 snapshot 中
    if (p.seq !== cur + 1) {
      buffer.push(p);
      void sync(); // 丢包：重新同步
      return;
    }
    useHub.setState((s) => ({ model: { ...applyPush(s.model, p.push), seq: p.seq } }));
  });
  return () => {
    offStatus();
    offPush();
  };
}

let started = false;
export function startHub(): void {
  if (started) return;
  started = true;
  const q = new URLSearchParams(window.location.search + "&" + (window.location.hash.split("?")[1] ?? ""));
  const mock = q.get("mock") === "1" || localStorage.getItem("muster.mock") === "1";
  const url = q.get("daemon") ?? "ws://127.0.0.1:7788/ws";
  const token = q.get("token") ?? undefined;
  attachClient(mock ? createMockClient() : createWsClient(url, token), mock);
}
