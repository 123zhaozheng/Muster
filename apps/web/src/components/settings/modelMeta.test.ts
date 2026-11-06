import { describe, expect, it } from "vitest";
import {
  builtinUpsert, configToUpsert, customUpsert, formatContext, formatPrice, friendlyTestError, groupCatalog, refToValue, splitModelIds,
  validateCustom, valueToRef, withSetting,
} from "./modelMeta";
import { CATALOG, EXISTING } from "./modelTestSetup";

describe("modelMeta", () => {
  it("目录按 国内/国际/聚合/本地 排序分组", () => {
    const g = groupCatalog([...CATALOG].reverse());
    expect(g.map((x) => x.group)).toEqual(["国内", "国际", "聚合"]);
  });

  it("格式化上下文与价格", () => {
    expect(formatContext(128000)).toBe("128K");
    expect(formatContext(1_000_000)).toBe("1M");
    expect(formatContext()).toBe("—");
    expect(formatPrice({ costInput: 0.6, costOutput: 2.5 })).toBe("$0.60 / $2.50");
    expect(formatPrice({})).toBe("—");
  });

  it("ModelRef 与 Select 值互转", () => {
    const ref = { provider: "moonshot", modelId: "kimi-k2" };
    expect(valueToRef(refToValue(ref))).toEqual(ref);
    expect(valueToRef(refToValue(undefined))).toBeUndefined();
  });

  it("withSetting 设置与清除", () => {
    const a = withSetting({ native: { provider: "x", modelId: "y" } }, "router", { provider: "p", modelId: "m" });
    expect(a).toEqual({ native: { provider: "x", modelId: "y" }, router: { provider: "p", modelId: "m" } });
    expect(withSetting(a, "native")).toEqual({ router: { provider: "p", modelId: "m" } });
  });

  it("自定义服务校验", () => {
    expect(validateCustom({ kind: "openai-compatible", name: "", baseUrl: "", modelIds: [] })).toEqual({
      name: "请给这个服务起个名字", baseUrl: "请填写 Base URL", modelIds: "至少添加一个模型 ID",
    });
    expect(validateCustom({ kind: "openai-compatible", name: "n", baseUrl: "not a url", modelIds: ["m"] }).baseUrl).toMatch(/有效/);
    expect(validateCustom({ kind: "openai-compatible", name: "n", baseUrl: "ftp://x.com", modelIds: ["m"] }).baseUrl).toMatch(/http/);
    expect(validateCustom({ kind: "anthropic-compatible", name: "n", baseUrl: "http://localhost:11434/v1", modelIds: ["m"] })).toEqual({});
  });

  it("splitModelIds 去重并支持多种分隔符", () => {
    expect(splitModelIds("a, b\nc  a，d")).toEqual(["a", "b", "c", "d"]);
  });

  it("内置 provider 的 upsert 参数：只带 key", () => {
    expect(builtinUpsert(CATALOG[0]!, " sk-1 ")).toEqual({
      provider: { id: "deepseek", kind: "builtin", builtinId: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", enabled: true },
      apiKey: "sk-1",
    });
    expect("apiKey" in builtinUpsert(CATALOG[0]!, "  ")).toBe(false);
  });

  it("自定义 upsert：key 留空不发送，清除发送空串", () => {
    const f = { kind: "openai-compatible" as const, name: " 网关 ", baseUrl: " http://x/v1 ", modelIds: ["m1"] };
    expect(customUpsert(f, "")).toEqual({ provider: { kind: "openai-compatible", name: "网关", baseUrl: "http://x/v1", enabled: true, modelIds: ["m1"] } });
    expect(customUpsert(f, "k", { id: "custom-1" }).apiKey).toBe("k");
    expect(customUpsert(f, "k", { clearKey: true }).apiKey).toBe("");
  });

  it("configToUpsert 不带 hasApiKey / createdAt，也不带 key", () => {
    const u = configToUpsert(EXISTING, { enabled: false });
    expect(u.provider).toEqual({ id: "moonshot", kind: "builtin", builtinId: "moonshot", name: "Moonshot", enabled: false });
    expect("apiKey" in u).toBe(false);
  });

  it("测试失败给友好原因", () => {
    expect(friendlyTestError("401 Unauthorized")).toMatch(/API Key/);
    expect(friendlyTestError("fetch failed ECONNREFUSED")).toMatch(/连不上/);
    expect(friendlyTestError("")).toMatch(/请求没有成功/);
  });
});
