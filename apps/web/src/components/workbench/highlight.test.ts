import { describe, expect, it } from "vitest";
import type { DiffFile } from "@muster/protocol";
import { highlightLine, langFamily } from "./highlight";
import { buildFileTree, diffStats, entrySummary, formatDuration, modelLabel, taskElapsedMs, toolKind } from "./logic";

describe("highlightLine", () => {
  const join = (line: string, fam?: Parameters<typeof highlightLine>[1]) => highlightLine(line, fam).map((t) => t.text).join("");
  it("拼回去等于原文（含字符串、注释、未闭合引号）", () => {
    for (const l of ["const a = 'x' + \"y\"; // 注释", "  return res.status(401).json({ error: 'Invalid signature' })", "echo \"oops", "", "  \t"]) {
      expect(join(l)).toBe(l);
    }
  });
  it("识别关键字、字符串、数字、函数、注释", () => {
    const types = (l: string, fam?: Parameters<typeof highlightLine>[1]) => Object.fromEntries(highlightLine(l, fam).map((t) => [t.text, t.type]));
    expect(types("const n = 42; foo('a') // hi")).toMatchObject({ const: "kw", "42": "num", foo: "fn", "'a'": "str", "// hi": "com" });
    expect(types("x = 1  # note", "hash")).toMatchObject({ "# note": "com" });
    expect(types('{"a": 1}', "json")).toMatchObject({ '"a"': "str" });
  });
  it("JSON 里的 // 不是注释；SQL 大小写不敏感", () => {
    expect(highlightLine('"http://x"', "json")).toEqual([{ type: "str", text: '"http://x"' }]);
    expect(highlightLine("SELECT 1", "sql")[0]).toEqual({ type: "kw", text: "SELECT" });
  });
  it("langFamily 由语言名或路径推断", () => {
    expect(langFamily("python")).toBe("hash");
    expect(langFamily(undefined, "a/b/config.yaml")).toBe("hash");
    expect(langFamily(undefined, "data.json")).toBe("json");
    expect(langFamily("whatever")).toBe("ts");
  });
});

describe("工单详情纯函数", () => {
  it("formatDuration / taskElapsedMs", () => {
    expect(formatDuration(42_000)).toBe("42 秒");
    expect(formatDuration(12 * 60_000)).toBe("12 分钟");
    expect(formatDuration(65 * 60_000)).toBe("1 小时 05 分");
    const t = { startedAt: "2026-01-01T00:00:00Z", status: "running" as const };
    expect(taskElapsedMs(t, Date.parse("2026-01-01T00:10:00Z"))).toBe(600_000);
    expect(taskElapsedMs({ ...t, status: "done", finishedAt: "2026-01-01T00:02:00Z" }, Date.now())).toBe(120_000);
    expect(taskElapsedMs({ ...t, startedAt: "bad" }, 0)).toBeUndefined();
  });
  it("modelLabel", () => {
    expect(modelLabel({ model: { provider: "deepseek", modelId: "deepseek-chat" } })).toBe("deepseek / deepseek-chat");
    expect(modelLabel({})).toBeUndefined();
    expect(modelLabel(undefined)).toBeUndefined();
  });
  const f = (path: string, additions = 1, deletions = 0): DiffFile => ({ path, additions, deletions, patch: "" });
  it("diffStats / buildFileTree：折叠单链目录、目录在前", () => {
    expect(diffStats([f("a", 3, 1), f("b", 2, 4)])).toEqual({ files: 2, additions: 5, deletions: 5 });
    const tree = buildFileTree([f("z.ts"), f("src/deep/x.ts"), f("src/deep/y.ts"), f("src/a.ts")]);
    expect(tree.map((n) => n.name)).toEqual(["src", "z.ts"]);
    expect(tree[0]!.children.map((n) => n.name)).toEqual(["deep", "a.ts"]);
    const single = buildFileTree([f("payment/callback.ts")]);
    expect(single[0]!.name).toBe("payment");
    const chain = buildFileTree([f("a/b/c/x.ts")]);
    expect(chain[0]!.name).toBe("a/b/c");
    expect(chain[0]!.children[0]!.file?.path).toBe("a/b/c/x.ts");
  });
  it("toolKind / entrySummary", () => {
    expect(toolKind("bash")).toBe("command");
    expect(toolKind("Read")).toBe("read");
    expect(toolKind("apply_patch")).toBe("edit");
    expect(toolKind("grep")).toBe("search");
    expect(toolKind("zzz")).toBe("other");
    const base = { id: "e", threadId: "t", ts: "" };
    expect(entrySummary({ ...base, kind: "test_result", botId: "b", passed: 3, failed: 1 })).toBe("3 通过 · 1 失败");
    expect(entrySummary({ ...base, kind: "bot", botId: "b", text: "x".repeat(100) }).endsWith("…")).toBe(true);
    expect(entrySummary({ ...base, kind: "tool_summary", botId: "b", reads: 2, commands: 0, edits: 1, items: [] })).toBe("读取了 2 个文件 · 修改了 1 个文件");
  });
});
