import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WirePush } from "@muster/protocol";
import { createWsClient } from "./wsClient";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  // 以下是测试用的服务端动作
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  serverClose() {
    this.close();
  }
  serverSend(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
const make = (token?: string) => createWsClient("ws://x/ws", token, { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket });

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
});
afterEach(() => vi.useRealTimers());

describe("createWsClient", () => {
  it("token 作为查询参数；状态依次 connecting -> open", () => {
    const c = make("a b");
    const states: string[] = [];
    c.onStatus((s) => states.push(s));
    expect(last().url).toBe("ws://x/ws?token=a%20b");
    last().open();
    expect(states).toEqual(["open"]);
    c.close();
  });

  it("请求/响应按 id 关联；错误响应 reject 为 code: message", async () => {
    const c = make();
    last().open();
    const ok = c.request("device.list", {});
    const bad = c.request("trigger.delete", { triggerId: "x" });
    const [r1, r2] = last().sent.map((s) => JSON.parse(s) as { id: string; method: string });
    expect(r1!.method).toBe("device.list");
    last().serverSend({ type: "res", id: r2!.id, ok: false, error: { code: "not_found", message: "没有" } });
    last().serverSend({ type: "res", id: r1!.id, ok: true, result: { devices: [] } });
    await expect(ok).resolves.toEqual({ devices: [] });
    await expect(bad).rejects.toThrow("not_found: 没有");
    c.close();
  });

  it("push 分发给订阅者，坏帧被忽略", () => {
    const c = make();
    const got: WirePush[] = [];
    c.onPush((p) => got.push(p));
    last().open();
    last().onmessage?.({ data: "{not json" });
    last().serverSend({ type: "push", seq: 3, push: { kind: "trigger.deleted", triggerId: "t" } });
    expect(got.map((p) => p.seq)).toEqual([3]);
    c.close();
  });

  it("未连接时请求立即失败", async () => {
    const c = make();
    await expect(c.request("device.list", {})).rejects.toThrow("not connected");
    c.close();
  });

  it("15 秒无响应则超时，且迟到的响应被忽略", async () => {
    const c = make();
    last().open();
    const p = c.request("device.list", {});
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(14_999);
    await vi.advanceTimersByTimeAsync(2);
    expect(((await caught) as Error).message).toMatch(/^timeout/);
    const id = (JSON.parse(last().sent[0]!) as { id: string }).id;
    expect(() => last().serverSend({ type: "res", id, ok: true, result: {} })).not.toThrow();
    c.close();
  });

  it("断线：在途请求立即失败，按退避重连，重连成功后退避归零", async () => {
    const c = make();
    const states: string[] = [];
    c.onStatus((s) => states.push(s));
    last().open();
    const inflight = c.request("device.list", {}).catch((e: Error) => e.message);
    last().serverClose();
    expect(await inflight).toBe("connection closed");
    expect(states).toEqual(["open", "closed"]); // onStatus 在首次 connecting 之后才订阅

    await expect(c.request("device.list", {})).rejects.toThrow("not connected");
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300); // 第 1 次退避 300ms
    expect(FakeWebSocket.instances).toHaveLength(2);
    last().serverClose();
    await vi.advanceTimersByTimeAsync(599);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // 第 2 次 600ms
    expect(FakeWebSocket.instances).toHaveLength(3);

    last().open();
    expect(states.at(-1)).toBe("open");
    last().serverClose();
    await vi.advanceTimersByTimeAsync(300); // 成功连接后退避从头开始
    expect(FakeWebSocket.instances).toHaveLength(4);
    c.close();
  });

  it("close() 之后不再重连，后续请求失败", async () => {
    const c = make();
    last().open();
    c.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await expect(c.request("device.list", {})).rejects.toThrow("not connected");
  });
});
