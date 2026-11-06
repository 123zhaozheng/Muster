import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot, WirePush } from "@muster/protocol";
import { snapshot as fixtureSnapshot } from "@muster/protocol/fixtures";
import { emptyModel } from "@muster/protocol/reducer";
import type { MusterClient } from "@muster/protocol/client";
import { attachClient, useHub } from "./hub";

type Status = "connecting" | "open" | "closed";

/** 可手动驱动的假 client：自己决定何时回 snapshot、何时推送。 */
function fakeClient() {
  let pushH: (p: WirePush) => void = () => {};
  let statusH: (s: Status) => void = () => {};
  const snapshots: Array<(s: Snapshot) => void> = [];
  const client: MusterClient = {
    request: vi.fn((method: string) => {
      if (method === "hub.snapshot") return new Promise<Snapshot>((resolve) => snapshots.push(resolve));
      if (method === "task.branches") return Promise.resolve({ branches: [] });
      return Promise.reject(new Error("unsupported"));
    }) as MusterClient["request"],
    onPush: (h) => { pushH = h; return () => {}; },
    onStatus: (h) => { statusH = h; return () => {}; },
    close: () => {},
  };
  const snap = (seq: number, detail = "初始"): Snapshot => ({
    ...structuredClone(fixtureSnapshot),
    seq,
    bots: fixtureSnapshot.bots.map((b) => (b.id === "bot-xiaoma" ? { ...b, statusDetail: detail } : b)),
  });
  const push = (seq: number, detail: string): WirePush => ({
    type: "push",
    seq,
    push: { kind: "bot.updated", bot: { ...fixtureSnapshot.bots[1]!, statusDetail: detail } },
  });
  return {
    client,
    snap,
    push,
    emitStatus: (s: Status) => statusH(s),
    emitPush: (p: WirePush) => pushH(p),
    answerSnapshot: (s: Snapshot) => snapshots.shift()!(s),
    pendingSnapshots: () => snapshots.length,
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const detail = () => useHub.getState().model.bots["bot-xiaoma"]?.statusDetail;
const seq = () => useHub.getState().model.seq;

let detach: () => void;
beforeEach(() => {
  useHub.setState({ model: emptyModel(), status: "connecting", client: null, mock: false, loadedThreads: {} });
});
afterEach(() => detach?.());

describe("hub store 按 seq 应用推送", () => {
  it("open 后拉 snapshot；已被 snapshot 覆盖的 push 丢弃，连续的 push 依次应用", async () => {
    const f = fakeClient();
    detach = attachClient(f.client);
    f.emitStatus("open");
    f.answerSnapshot(f.snap(5));
    await flush();
    expect(seq()).toBe(5);
    expect(useHub.getState().status).toBe("open");

    f.emitPush(f.push(5, "旧的"));
    expect(detail()).toBe("初始");
    f.emitPush(f.push(6, "第六"));
    f.emitPush(f.push(7, "第七"));
    expect(seq()).toBe(7);
    expect(detail()).toBe("第七");
  });

  it("拉 snapshot 期间到达的 push 先缓冲，落地后按 seq 重放（旧的丢弃）", async () => {
    const f = fakeClient();
    detach = attachClient(f.client);
    f.emitStatus("open");
    f.emitPush(f.push(7, "第七"));
    f.emitPush(f.push(4, "过期"));
    f.emitPush(f.push(6, "第六"));
    f.answerSnapshot(f.snap(5));
    await flush();
    expect(seq()).toBe(7);
    expect(detail()).toBe("第七");
  });

  it("seq 出现缺口时重新拉 snapshot", async () => {
    const f = fakeClient();
    detach = attachClient(f.client);
    f.emitStatus("open");
    f.answerSnapshot(f.snap(5));
    await flush();

    f.emitPush(f.push(6, "第六"));
    f.emitPush(f.push(9, "第九（丢了 7、8）"));
    expect(seq()).toBe(6); // 缺口 push 不直接应用
    expect(f.pendingSnapshots()).toBe(1);
    f.answerSnapshot(f.snap(9, "服务端最新"));
    await flush();
    expect(seq()).toBe(9);
    expect(detail()).toBe("服务端最新");
  });

  it("重连后（closed -> open）重新同步，守护进程重启导致 seq 回退也能接上", async () => {
    const f = fakeClient();
    detach = attachClient(f.client);
    f.emitStatus("open");
    f.answerSnapshot(f.snap(50));
    await flush();
    f.emitStatus("closed");
    expect(useHub.getState().status).toBe("closed");
    f.emitStatus("connecting");
    f.emitStatus("open");
    f.answerSnapshot(f.snap(2, "重启后"));
    await flush();
    expect(seq()).toBe(2);
    f.emitPush(f.push(3, "继续"));
    expect(detail()).toBe("继续");
  });
});
