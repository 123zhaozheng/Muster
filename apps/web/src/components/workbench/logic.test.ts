import { describe, expect, it } from "vitest";
import type { Entry } from "@muster/protocol";
import { entriesByThread } from "@muster/protocol/fixtures";
import { collectCommands, collectDiffFiles, formatTokens, isBusy, lastTestResult, parseUnifiedDiff, resolveSendMode, steerLabel, taskAvatarStatus, toolSummaryText } from "./logic";

describe("resolveSendMode", () => {
  it("忙碌：Enter=steer, Alt+Enter=queue, Ctrl/Cmd+Enter=interrupt", () => {
    expect(resolveSendMode({ key: "Enter" }, true)).toBe("steer");
    expect(resolveSendMode({ key: "Enter", altKey: true }, true)).toBe("queue");
    expect(resolveSendMode({ key: "Enter", ctrlKey: true }, true)).toBe("interrupt");
    expect(resolveSendMode({ key: "Enter", metaKey: true }, true)).toBe("interrupt");
  });
  it("空闲：所有 Enter 组合都是 normal", () => {
    expect(resolveSendMode({ key: "Enter" }, false)).toBe("normal");
    expect(resolveSendMode({ key: "Enter", altKey: true }, false)).toBe("normal");
    expect(resolveSendMode({ key: "Enter", ctrlKey: true }, false)).toBe("normal");
  });
  it("Shift+Enter、输入法组字、其他按键不发送", () => {
    expect(resolveSendMode({ key: "Enter", shiftKey: true }, true)).toBeNull();
    expect(resolveSendMode({ key: "Enter", isComposing: true }, true)).toBeNull();
    expect(resolveSendMode({ key: "a" }, true)).toBeNull();
  });
});

describe("文案", () => {
  it("steerLabel", () => {
    expect(steerLabel({ mode: "steer", applied: "next_step" })).toBe("插话 · 下一步生效");
    expect(steerLabel({ mode: "steer", applied: "applied" })).toBe("已采纳");
    expect(steerLabel({ mode: "queue", applied: "pending" })).toBe("排队中");
    expect(steerLabel({ mode: "interrupt", applied: "applied" })).toBe("已打断");
  });
  it("toolSummaryText 省略为 0 的部分", () => {
    expect(toolSummaryText({ reads: 6, commands: 2, edits: 0 })).toBe("读取了 6 个文件 · 运行了 2 条命令");
    expect(toolSummaryText({ reads: 4, commands: 1, edits: 1 })).toBe("读取了 4 个文件 · 运行了 1 条命令 · 修改了 1 个文件");
    expect(toolSummaryText({ reads: 0, commands: 0, edits: 0 })).toBe("工具活动");
  });
  it("formatTokens / isBusy / taskAvatarStatus", () => {
    expect(formatTokens(12_400)).toBe("12.4K");
    expect(formatTokens(800)).toBe("800");
    expect(formatTokens(undefined)).toBe("—");
    expect(isBusy({ status: "running" })).toBe(true);
    expect(isBusy({ status: "done" })).toBe(false);
    expect(taskAvatarStatus({ status: "failed" })).toBe("error");
    expect(taskAvatarStatus({ status: "waiting_approval" }, "working")).toBe("waiting_approval");
  });
});

describe("parseUnifiedDiff", () => {
  it("解析 fixtures 的补丁：行号与增删类型", () => {
    const patch = entriesByThread["thread-fix-callback"]!.flatMap((e) => (e.kind === "diff" ? e.files : []))[0]!.patch;
    const lines = parseUnifiedDiff(patch);
    expect(lines[0]).toMatchObject({ type: "hunk" });
    const dels = lines.filter((l) => l.type === "del");
    const adds = lines.filter((l) => l.type === "add");
    expect(dels.map((l) => l.no)).toEqual([98, 99, 100]);
    expect(adds.map((l) => l.no)).toEqual([98, 99, 100]);
    expect(dels[0]!.text).toBe("  if (signature !== oldSig) {");
  });
  it("上下文行同时推进新旧行号；--- 头只在首个 @@ 之前算元信息", () => {
    const lines = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+c\n--d\n");
    expect(lines.slice(0, 2).every((l) => l.type === "meta")).toBe(true);
    expect(lines.slice(3).map((l) => [l.type, l.no, l.text])).toEqual([
      ["ctx", 1, "a"],
      ["del", 2, "b"],
      ["add", 2, "c"],
      ["del", 3, "-d"],
    ]);
  });
});

describe("汇总", () => {
  const e = (x: Partial<Entry> & { kind: Entry["kind"] }) => ({ id: Math.random().toString(), threadId: "t", ts: "2026-01-01T00:00:00Z", ...x }) as Entry;
  it("collectDiffFiles：同一路径取最新", () => {
    const files = collectDiffFiles([
      e({ kind: "diff", botId: "b", files: [{ path: "a.ts", additions: 1, deletions: 0, patch: "old" }] } as never),
      e({ kind: "diff", botId: "b", files: [{ path: "a.ts", additions: 2, deletions: 0, patch: "new" }, { path: "b.ts", additions: 1, deletions: 1, patch: "" }] } as never),
    ]);
    expect(files.map((f) => [f.path, f.patch])).toEqual([["a.ts", "new"], ["b.ts", ""]]);
  });
  it("collectCommands 只取命令类 tool；lastTestResult 取最后一次", () => {
    const entries = entriesByThread["thread-fix-callback"]!;
    expect(collectCommands(entries).map((c) => c.label)).toEqual(["pnpm test"]);
    expect(lastTestResult(entries)).toEqual({ passed: 12, failed: 0 });
    expect(lastTestResult([])).toBeUndefined();
  });
});
