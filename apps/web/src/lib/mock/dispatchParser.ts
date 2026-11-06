// Mock 版 Pip 的"分发"规则：从一句话里识别 Bot 名与对应任务标题（真实后端由路由器模型完成）。
import type { Bot } from "@muster/protocol";

interface DispatchIntent {
  bot: Bot;
  title: string;
}

const CLAUSE_SPLIT = /[，,。；;\n!！?？]|然后|并且|同时|以及/;
const LEAD = /^(?:把|帮我|帮|请|麻烦|先|再|另外|还有|和|并|去|来)\s*/;
const TAIL = /(?:吧|一下|呗|哦|啊)$/;
const MAX_TITLE = 30;

function cleanTitle(raw: string): string {
  let s = raw;
  const colon = Math.max(s.lastIndexOf("："), s.lastIndexOf(":"));
  if (colon >= 0) s = s.slice(colon + 1);
  s = s.trim();
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(LEAD, "").replace(TAIL, "").trim();
  }
  return s.length > MAX_TITLE ? `${s.slice(0, MAX_TITLE)}…` : s;
}

/** "交给小码修 xx，交给阿克写 yy" -> [{小码,"修 xx"},{阿克,"写 yy"}]。每个分句至多派给先出现的那个 Bot。 */
export function parseDispatch(text: string, bots: Bot[]): DispatchIntent[] {
  const subs = bots.filter((b) => b.kind !== "main");
  const out: DispatchIntent[] = [];
  let carry: Bot | undefined; // "小码，修支付回调" 这种名字单独成句的情况

  for (const clause of text.split(CLAUSE_SPLIT)) {
    let hit: { bot: Bot; at: number } | undefined;
    for (const b of subs) {
      const at = clause.indexOf(b.name);
      if (at >= 0 && (!hit || at < hit.at)) hit = { bot: b, at };
    }
    if (!hit) {
      if (carry) {
        const title = cleanTitle(clause);
        if (title) out.push({ bot: carry, title });
        carry = undefined;
      }
      continue;
    }
    const { name } = hit.bot;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = clause.replace(new RegExp(`(?:交给|转给|派给|让|叫|请|找|给)\\s*${escaped}`, "g"), "").replace(name, "");
    const title = cleanTitle(stripped);
    if (title) {
      out.push({ bot: hit.bot, title });
      carry = undefined;
    } else {
      carry = hit.bot;
    }
  }
  return out;
}
