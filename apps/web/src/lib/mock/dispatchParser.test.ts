import { describe, expect, it } from "vitest";
import { bots } from "@muster/protocol/fixtures";
import { parseDispatch } from "./dispatchParser";

const brief = (text: string) => parseDispatch(text, bots).map((i) => [i.bot.name, i.title]);

describe("parseDispatch", () => {
  it("概念稿里的例子：两件事分给两个 Bot", () => {
    expect(brief("shop-api 里两件事：修支付回调 bug 交给小码，写退款接口交给阿克")).toEqual([
      ["小码", "修支付回调 bug"],
      ["阿克", "写退款接口"],
    ]);
  });

  it("交给X + 动作", () => {
    expect(brief("交给小码修 xx，交给阿克写 yy")).toEqual([
      ["小码", "修 xx"],
      ["阿克", "写 yy"],
    ]);
  });

  it("让X…、名字单独成句", () => {
    expect(brief("让小探调研一下竞品")).toEqual([["小探", "调研一下竞品"]]);
    expect(brief("小码，修一下登录页")).toEqual([["小码", "修一下登录页"]]);
  });

  it("没有 Bot 名或只提到 Pip 时返回空", () => {
    expect(brief("今天天气怎么样")).toEqual([]);
    expect(brief("Pip 你好")).toEqual([]);
  });
});
