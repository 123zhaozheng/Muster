import { describe, expect, it } from "vitest";
import { branches } from "@muster/protocol/fixtures";
import { compareBranches } from "./compare";

describe("compareBranches", () => {
  it("fixtures：A 测试全过、B 改动更少且更省 token", () => {
    const v = compareBranches(branches);
    expect(v["br-a"]).toMatchObject({ bestTests: true, fewestFiles: false, cheapest: false, filesOver: 1, tokensOver: 600 });
    expect(v["br-b"]).toMatchObject({ bestTests: false, fewestFiles: true, cheapest: true, filesOver: 0, tokensOver: 0 });
  });
  it("单个分支或完全相同时不高亮", () => {
    expect(compareBranches([branches[0]!])["br-a"]).toMatchObject({ bestTests: false, fewestFiles: false, cheapest: false });
    const same = compareBranches([branches[0]!, { ...branches[0]!, id: "x" }]);
    expect(same["x"]).toMatchObject({ bestTests: false, fewestFiles: false, cheapest: false });
  });
  it("缺 token 数据时不给 tokensOver", () => {
    const v = compareBranches([branches[0]!, { ...branches[1]!, tokens: undefined }]);
    expect(v["br-b"]!.tokensOver).toBeUndefined();
    expect(v["br-a"]!.cheapest).toBe(false); // 只有一个有数据，不比较
  });
});
