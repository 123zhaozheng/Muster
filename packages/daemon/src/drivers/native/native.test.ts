import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DriverEvent, DriverSession } from "../../core/contracts";
import { createNativeDriver, type NativeDriver } from "./index";

let dir: string;
const drivers: NativeDriver[] = [];
const sessions: DriverSession[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "muster-native-"));
});

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const d of drivers.splice(0)) await d.close();
  await rm(dir, { recursive: true, force: true });
});

function setup(responses: FauxResponseStep[]) {
  const faux = fauxProvider({ tokensPerSecond: 400 });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const open = () => {
    const driver = createNativeDriver({ dataDir: dir, modelSource: { models, model: { provider: faux.provider.id, modelId: faux.getModel().id } } });
    drivers.push(driver);
    return driver;
  };
  return { faux, open };
}

/** 后台消费事件流；waitFor 轮询直到出现满足条件的事件。 */
function collect(session: DriverSession) {
  sessions.push(session);
  const events: DriverEvent[] = [];
  void (async () => {
    for await (const e of session.events) events.push(e);
  })();
  return {
    events,
    async waitFor(pred: (e: DriverEvent) => boolean, from = 0): Promise<DriverEvent> {
      const deadline = Date.now() + 8000;
      for (;;) {
        const hit = events.slice(from).find(pred);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`等待事件超时，已有：${JSON.stringify(events.map((e) => e.t))}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
}

const kinds = (events: DriverEvent[]) => events.map((e) => e.t);

/** faux 的工具调用必须显式标 stopReason: toolUse，否则 pi-durable 把它当作最终答复。 */
function callTool(name: string, args: Record<string, string>) {
  return fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
}

/** 让某一步的回答停在门口，直到 release()。 */
function gate(message: ReturnType<typeof fauxAssistantMessage>) {
  let release!: () => void;
  const opened = new Promise<void>((r) => (release = r));
  const step: FauxResponseStep = async () => {
    await opened;
    return message;
  };
  return { step, release };
}

describe("createNativeDriver 配置", () => {
  it("未配置模型时不抛错（start 时才给提示）", () => {
    expect(createNativeDriver({ dataDir: dir, env: {} }).kind).toBe("native");
    expect(createNativeDriver({ dataDir: dir, env: { MUSTER_NATIVE_MODEL: "m" } }).kind).toBe("native");
  });

  it("OpenAI 兼容配置可创建（不发请求）", () => {
    const env = { MUSTER_NATIVE_MODEL: "m", MUSTER_NATIVE_BASE_URL: "http://127.0.0.1:1/v1", MUSTER_NATIVE_API_KEY: "k" };
    expect(createNativeDriver({ dataDir: dir, env }).kind).toBe("native");
  });
});

describe("一轮对话", () => {
  it("产出 turn_start / text_delta / text_done / turn_end(completed)", async () => {
    const { open } = setup([fauxAssistantMessage("你好，我是小探，这是一段需要分块输出的较长回答。")]);
    const session = await open().start({ cwd: dir, prompt: "你好" });
    const { events, waitFor } = collect(session);
    await waitFor((e) => e.t === "turn_end");

    expect(events[0]).toEqual({ t: "turn_start", turn: 1 });
    expect(kinds(events).slice(-2)).toEqual(["text_done", "turn_end"]);
    const text = events.flatMap((e) => (e.t === "text_delta" ? [e.delta] : [])).join("");
    expect(text).toBe("你好，我是小探，这是一段需要分块输出的较长回答。");
    expect(events.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });
    expect(session.caps).toMatchObject({ steer: true, fork: true, interrupt: true });
  });

  it("工具调用产出 tool 事件，且文本不重复", async () => {
    await writeFile(join(dir, "a.txt"), "内容A");
    const { open } = setup([
      callTool("read", { path: "a.txt" }),
      fauxAssistantMessage("读到了：内容A"),
    ]);
    const session = await open().start({ cwd: dir, prompt: "读 a.txt" });
    const { events, waitFor } = collect(session);
    await waitFor((e) => e.t === "turn_end");

    const tool = events.find((e) => e.t === "tool");
    expect(tool).toMatchObject({ t: "tool", tool: "read", kind: "read", ok: true });
    expect(tool && tool.t === "tool" && tool.output).toContain("内容A");
    expect(events.flatMap((e) => (e.t === "text_delta" ? [e.delta] : [])).join("")).toBe("读到了：内容A");
  });
});

describe("steer / queue / interrupt", () => {
  it("运行中 steer 并入当前轮，产出 steer_applied", async () => {
    await writeFile(join(dir, "a.txt"), "x");
    const first = gate(callTool("read", { path: "a.txt" }));
    let secondSawSteer = false;
    const { open } = setup([
      first.step,
      (ctx) => {
        secondSawSteer = JSON.stringify(ctx.messages).includes("改用中文");
        return fauxAssistantMessage("好的，改用中文");
      },
    ]);
    const session = await open().start({ cwd: dir, prompt: "start" });
    const { events, waitFor } = collect(session);
    await waitFor((e) => e.t === "turn_start");

    await session.send("改用中文", "steer");
    first.release();
    await waitFor((e) => e.t === "turn_end");

    expect(secondSawSteer).toBe(true);
    expect(kinds(events).filter((t) => t === "turn_start")).toHaveLength(1);
    expect(events.find((e) => e.t === "steer_applied")).toEqual({ t: "steer_applied", text: "改用中文" });
  });

  it("queue 在当前轮结束后另起一轮", async () => {
    const first = gate(fauxAssistantMessage("第一轮答复"));
    const { open } = setup([first.step, fauxAssistantMessage("第二轮答复")]);
    const session = await open().start({ cwd: dir, prompt: "one" });
    const { events, waitFor } = collect(session);
    await waitFor((e) => e.t === "turn_start");

    await session.send("two", "queue");
    first.release();
    await waitFor((e) => e.t === "turn_end" && events.filter((x) => x.t === "turn_end").length === 2);

    const starts = events.filter((e) => e.t === "turn_start");
    expect(starts).toEqual([{ t: "turn_start", turn: 1 }, { t: "turn_start", turn: 2 }]);
    // 事件顺序：turn_start(1) … turn_end(1) … turn_start(2) … turn_end(2)
    const order = kinds(events).filter((t) => t === "turn_start" || t === "turn_end");
    expect(order).toEqual(["turn_start", "turn_end", "turn_start", "turn_end"]);
  });

  it("interrupt 终止当前轮并给出 interrupted", async () => {
    const never = gate(fauxAssistantMessage("不会出现"));
    const { open } = setup([never.step, fauxAssistantMessage("打断后的新答复")]);
    const session = await open().start({ cwd: dir, prompt: "long" });
    const { events, waitFor } = collect(session);
    await waitFor((e) => e.t === "turn_start");

    // faux 的门不理会 abort 信号；放行后 pi-durable 也应因 abort 标记丢弃这次结果。
    const interrupting = session.interrupt();
    never.release();
    await interrupting;
    await waitFor((e) => e.t === "turn_end");
    expect(events.at(-1)).toMatchObject({ t: "turn_end", status: "interrupted" });

    await session.send("再来", "normal");
    await waitFor((e) => e.t === "turn_end", events.length);
    expect(events.at(-1)).toMatchObject({ t: "turn_end", status: "completed" });
    expect(events.filter((e) => e.t === "turn_start").map((e) => e.t === "turn_start" && e.turn)).toEqual([1, 2]);
  });

  it("send(interrupt) 先打断再提交新消息", async () => {
    const never = gate(fauxAssistantMessage("不会出现"));
    const { open } = setup([never.step, fauxAssistantMessage("改道后的答复")]);
    const session = await open().start({ cwd: dir, prompt: "long" });
    const { events, waitFor } = collect(session);
    await waitFor((e) => e.t === "turn_start");

    const sending = session.send("换个方向", "interrupt");
    never.release();
    await sending;
    await waitFor((e) => e.t === "turn_end" && events.filter((x) => x.t === "turn_end").length === 2);

    const ends = events.filter((e) => e.t === "turn_end");
    expect(ends[0]).toMatchObject({ status: "interrupted" });
    expect(ends[1]).toMatchObject({ status: "completed" });
  });
});

describe("审批", () => {
  it("写文件先发 approval；允许后执行，拒绝后工具失败", async () => {
    const target = join(dir, "out.txt");
    const { open } = setup([
      callTool("write", { path: "out.txt", content: "hello" }),
      fauxAssistantMessage("写好了"),
      callTool("write", { path: "denied.txt", content: "nope" }),
      fauxAssistantMessage("被拒绝了"),
    ]);
    const session = await open().start({ cwd: dir, prompt: "写文件" });
    const { events, waitFor } = collect(session);

    const approval = await waitFor((e) => e.t === "approval");
    expect(approval).toMatchObject({ t: "approval", title: "写入文件", detail: "out.txt", risk: "medium" });
    if (approval.t !== "approval") throw new Error("unreachable");
    await session.resolveApproval(approval.requestId, true);
    await waitFor((e) => e.t === "turn_end");
    expect(await readFile(target, "utf8")).toBe("hello");

    const mark = events.length;
    await session.send("再写一个", "normal");
    const second = await waitFor((e) => e.t === "approval", mark);
    if (second.t !== "approval") throw new Error("unreachable");
    await session.resolveApproval(second.requestId, false);
    await waitFor((e) => e.t === "turn_end", mark);
    const denied = events.slice(mark).find((e) => e.t === "tool");
    expect(denied).toMatchObject({ t: "tool", tool: "write", ok: false });
    await expect(readFile(join(dir, "denied.txt"), "utf8")).rejects.toThrow();
  });
});

describe("fork", () => {
  it("从第 1 轮分支：继承历史，不含第 2 轮，且互相独立", async () => {
    let forkContext = "";
    const { open } = setup([
      fauxAssistantMessage("答一"),
      fauxAssistantMessage("答二"),
      (ctx) => {
        forkContext = JSON.stringify(ctx.messages);
        return fauxAssistantMessage("分支答复");
      },
    ]);
    const session = await open().start({ cwd: dir, prompt: "问一" });
    const parent = collect(session);
    await parent.waitFor((e) => e.t === "turn_end");
    await session.send("问二", "normal");
    await parent.waitFor((e) => e.t === "turn_end", parent.events.length);

    const branch = await session.fork(1);
    expect(branch.nativeId).not.toBe(session.nativeId);
    const child = collect(branch);
    await branch.send("分支提问", "normal");
    await child.waitFor((e) => e.t === "turn_end");

    expect(child.events[0]).toEqual({ t: "turn_start", turn: 2 }); // 继承了第 1 轮
    expect(forkContext).toContain("问一");
    expect(forkContext).toContain("答一");
    expect(forkContext).toContain("分支提问");
    expect(forkContext).not.toContain("问二");
    expect(forkContext).not.toContain("答二");
    expect(parent.events.filter((e) => e.t === "turn_start")).toHaveLength(2); // 父会话不受影响
  });

  it("不存在的轮次抛错", async () => {
    const { open } = setup([fauxAssistantMessage("ok")]);
    const session = await open().start({ cwd: dir, prompt: "q" });
    const { waitFor } = collect(session);
    await waitFor((e) => e.t === "turn_end");
    await expect(session.fork(5)).rejects.toThrow(/第 5 轮/);
  });
});

describe("崩溃恢复", () => {
  it("关闭后重开可用 nativeId 恢复历史并继续对话", async () => {
    let contextAfterReopen = "";
    const { open } = setup([
      fauxAssistantMessage("记住了：暗号是蓝鲸"),
      (ctx) => {
        contextAfterReopen = JSON.stringify(ctx.messages);
        return fauxAssistantMessage("暗号是蓝鲸");
      },
    ]);
    const driver1 = open();
    const session1 = await driver1.start({ cwd: dir, prompt: "暗号是蓝鲸，记住" });
    const first = collect(session1);
    await first.waitFor((e) => e.t === "turn_end");
    const nativeId = session1.nativeId;
    await session1.close();
    await driver1.close(); // 模拟进程退出

    const session2 = await open().start({ cwd: dir, prompt: "", resumeNativeId: nativeId });
    const second = collect(session2);
    expect(session2.nativeId).toBe(nativeId);
    await session2.send("暗号是什么？", "normal");
    await second.waitFor((e) => e.t === "turn_end");

    expect(contextAfterReopen).toContain("暗号是蓝鲸，记住");
    expect(second.events[0]).toEqual({ t: "turn_start", turn: 2 }); // 轮次接着历史往下数
    expect(second.events.flatMap((e) => (e.t === "text_delta" ? [e.delta] : [])).join("")).toBe("暗号是蓝鲸");
  });

  it("运行中途关闭，重开后自动继续未完成的轮", async () => {
    const never = gate(fauxAssistantMessage("不会被使用"));
    const { faux, open } = setup([never.step]);
    const driver1 = open();
    const session1 = await driver1.start({ cwd: dir, prompt: "做一件长任务" });
    const first = collect(session1);
    await first.waitFor((e) => e.t === "turn_start");
    const nativeId = session1.nativeId;
    await session1.close();
    never.release();
    await driver1.close();

    faux.setResponses([fauxAssistantMessage("接着做完了")]);
    const session2 = await open().start({ cwd: dir, prompt: "", resumeNativeId: nativeId });
    const second = collect(session2);
    await second.waitFor((e) => e.t === "turn_end");
    expect(second.events.flatMap((e) => (e.t === "text_delta" ? [e.delta] : [])).join("")).toBe("接着做完了");
    expect(second.events.find((e) => e.t === "turn_start")).toBeUndefined(); // 同一轮，不重复开始
  });

  it("恢复不存在的会话时抛错", async () => {
    const { open } = setup([]);
    await expect(open().start({ cwd: dir, prompt: "", resumeNativeId: "9999" })).rejects.toThrow(/不存在/);
  });
});
