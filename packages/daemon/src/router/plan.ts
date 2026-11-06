// 规则快路径：把用户一句话切分成“Bot + 任务”的分发计划。纯函数，不依赖 Hub。
import type { Bot } from "@muster/protocol";

export interface PlannedTask {
  bot: Bot;
  /** ≤16 字的短标题 */
  title: string;
  /** 交给子 Bot 的完整指令（含上下文） */
  prompt: string;
  /** 用户没点名，由关键字选出的 Bot */
  auto?: boolean;
}

export interface Plan {
  reply: string;
  tasks: PlannedTask[];
}

// ───────────────────────── 文本工具 ─────────────────────────

const STRONG_SPLIT = /[，,；;。\n！!]+/;
const GIVE = "交给|转给|发给|丢给|派给|分给|安排给|委托给|指派给";
const ASK = "让|叫|请|麻烦|拜托|找|由|喊|通知|@";
const DIRECTIVE_TAIL = new RegExp(`(${GIVE}|${ASK})\\s*$`);
const GIVE_TAIL = new RegExp(`(?:${GIVE})\\s*$`);
const LEAD_FILLER = /^(?:请你?|麻烦|拜托|帮我|帮忙|首先|其次|最后|先|然后|接着|再|另外|还有|同时|并且|并|顺便|以及|把|将|\s)+/;
const AFTER_FILLER = /^(?:[：:，,\s]|去|来|帮忙|帮我|负责)+/;
const TRAIL_FILLER = /(?:[。.!！\s]|吧|一下|谢谢|麻烦了)+$/;
const CONJ_SPLIT = /和|、|以及|并且|然后|同时|还有/;
const GREETING_ONLY = /^(?:你好|您好|嗨|hi|hello|好的|好|ok|嗯|请|麻烦了?|谢谢|多谢)[啊呀哈!！。~\s]*$/i;
const CHITCHAT = /^(?:你好|您好|嗨|hi\b|hello\b|谢谢|多谢|哈哈|嗯|ok\b|在吗|你是谁|你能做什么|你会什么|怎么用|帮助|help\b)/i;
const QUESTION_TASK = /^(?:是谁|是什么|在吗|你好|怎么样|好吗)|[吗？?]$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const len = (s: string) => [...s].length;

const cleanLead = (s: string) => s.replace(LEAD_FILLER, "").replace(TRAIL_FILLER, "").trim();
const cleanAfter = (s: string) => s.replace(AFTER_FILLER, "").replace(TRAIL_FILLER, "").trim();

/** ≤16 字短标题。 */
export function makeTitle(task: string): string {
  const t = task
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。.!！?？,，;；:：]+$/, "")
    .replace(/^(?:请|帮我|帮忙|先|去|来)+/, "")
    .trim();
  if (!t) return "新任务";
  const chars = [...t];
  return chars.length <= 16 ? t : chars.slice(0, 15).join("") + "…";
}

// ───────────────────────── Bot 名匹配 ─────────────────────────

interface Roster {
  /** 匹配 Bot 名（及 codex / claude 别名）的全局正则；无可选 Bot 时为 null */
  re: RegExp | null;
  lookup(token: string): Bot | undefined;
  byRole(role: Role): Bot | undefined;
  /** 按技能 / 人设 / 简介给用户自建成员打分（内置角色 Bot 不参与）；无命中时为 null */
  matchCustom(seg: string): { bot: Bot; score: number } | null;
  names: string[];
}

// 用户自建成员的特征匹配：中文按二元组、英文按单词，在技能（权重 2）/ 人设与简介（权重 1）里找。
const STOP_FEATURES = new Set(
  "帮我 一下 这个 那个 请你 一个 我们 你们 需要 进行 可以 能够 如何 怎么 什么 一份 这份 这段 一些 以及 或者 还有 然后 之后 的话 助手 负责 擅长 专业 相关 问题 工作 任务 内容 用户 提供 帮助 协助 完成 根据 使用 你是 一位 我是 the and for with".split(" "),
);

function features(text: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const run of lower.match(/[一-鿿]+/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  for (const w of lower.match(/[a-z][a-z0-9+#.-]+/g) ?? []) out.add(w);
  return [...out].filter((f) => !STOP_FEATURES.has(f));
}

type Role = "code" | "claude" | "research" | "office";

function buildRoster(allBots: Bot[]): Roster {
  const bots = allBots.filter((b) => b.kind !== "main");
  const map = new Map<string, Bot>();
  for (const b of bots) map.set(b.name.toLowerCase(), b);
  const kindBot = (k: Bot["kind"]) => bots.find((b) => b.kind === k);
  for (const [alias, kind] of [["codex", "codex"], ["claude", "claude"]] as const) {
    const b = kindBot(kind);
    if (b && !map.has(alias)) map.set(alias, b);
  }
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  const skillBot = (re: RegExp) => bots.find((b) => re.test(`${b.skills.join(" ")} ${b.engineLabel} ${b.name}`));
  const roleBots: Record<Role, Bot | undefined> = {
    code: kindBot("codex") ?? skillBot(/代码|调试/),
    claude: kindBot("claude") ?? skillBot(/分析|写作/),
    research: skillBot(/研究|调研|小探/),
    office: skillBot(/文档|日程|办公|小文/),
  };
  // 纯英文名需要词边界（避免 “Lex” 命中 “flexible”）
  const keyPattern = (k: string) => (/^[a-z0-9 _.-]+$/i.test(k) ? `(?<![A-Za-z0-9])${escapeRe(k)}(?![A-Za-z0-9])` : escapeRe(k));
  const roleSet = new Set(Object.values(roleBots));
  const custom = bots
    .filter((b) => !roleSet.has(b))
    .map((b) => ({
      bot: b,
      skills: b.skills.join(" ").toLowerCase(),
      soft: [b.tagline, b.persona, b.engineLabel].filter(Boolean).join(" ").toLowerCase(),
    }));
  return {
    re: keys.length ? new RegExp(keys.map(keyPattern).join("|"), "gi") : null,
    lookup: (t) => map.get(t.toLowerCase()),
    byRole: (r) => roleBots[r],
    matchCustom: (seg) => {
      const fs = features(seg);
      let best: { bot: Bot; score: number } | null = null;
      for (const c of custom) {
        const score = fs.reduce((n, f) => n + (c.skills.includes(f) ? 2 : c.soft.includes(f) ? 1 : 0), 0);
        if (score > (best?.score ?? 0)) best = { bot: c.bot, score };
      }
      return best;
    },
    names: bots.map((b) => b.name),
  };
}

// ───────────────────────── 单个片段解析（点名） ─────────────────────────

interface Parsed {
  bots: Bot[];
  /** 任务正文，可能为空（如“交给小码”，任务在前一片段） */
  task: string;
}

function analyzeSegment(seg: string, roster: Roster): Parsed | null {
  if (!roster.re) return null;
  const hits = [...seg.matchAll(roster.re)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, bot: roster.lookup(m[0]) }));
  const first = hits[0];
  if (!first?.bot) return null;

  // 相邻的多个名字（“小码和阿克”）视为同一组；非相邻的后续名字当作正文
  const group = [first];
  for (const h of hits.slice(1)) {
    const prev = group[group.length - 1]!;
    if (h.bot && /^\s*(?:和|、|与|跟|及|,|，|还有|以及)?\s*$/.test(seg.slice(prev.end, h.start))) group.push(h);
    else break;
  }
  const spanStart = first.start;
  const spanEnd = group[group.length - 1]!.end;
  const bots = [...new Set(group.map((g) => g.bot!))];

  let before = seg.slice(0, spanStart);
  const after = seg.slice(spanEnd);
  const directive = DIRECTIVE_TAIL.exec(before);
  const give = GIVE_TAIL.test(before);
  const colon = /^\s*[：:]/.test(after);
  if (directive) before = before.slice(0, directive.index);

  const beforeClean = cleanLead(before);
  const afterClean = cleanAfter(after);

  let task: string;
  if (give) {
    // “把 X 交给小码（去做）” / “交给小码 X”
    task = beforeClean && len(beforeClean) >= 2 ? (len(afterClean) >= 2 ? `${beforeClean} ${afterClean}` : beforeClean) : afterClean;
  } else if (directive || colon) {
    task = len(afterClean) >= 2 ? afterClean : beforeClean;
  } else {
    // 没有指令词：名字必须在句首（“小码修登录 bug”）或句尾（“修登录 bug 小码”）
    if (beforeClean && afterClean) return null;
    task = afterClean || beforeClean;
    if (QUESTION_TASK.test(task)) return null;
  }
  return { bots, task: len(task) >= 2 ? task : "" };
}

/** 片段内用“和/、”再切一次；仅当每一块都带点名且有任务时才接受。 */
function analyzeWithConjunctions(seg: string, roster: Roster): Parsed[] | null {
  const pieces = seg.split(CONJ_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (pieces.length > 1) {
    const parsed = pieces.map((p) => analyzeSegment(p, roster));
    if (parsed.every((p): p is Parsed => !!p && !!p.task)) return parsed;
  }
  const single = analyzeSegment(seg, roster);
  return single ? [single] : null;
}

// ───────────────────────── 顶层切分 ─────────────────────────

/** 去掉开头对 Pip 的称呼；若冒号前是不含点名的背景（“shop-api 里两件事：…”）则拆出背景。 */
function splitContext(text: string, roster: Roster): { context: string; body: string } {
  let body = text.trim().replace(/^pip[\s，,：:]*/i, "");
  const m = /^([^：:\n]{1,30})[：:]([\s\S]+)$/.exec(body);
  if (m) {
    const prefix = m[1]!.trim();
    const hasName = roster.re ? new RegExp(roster.re.source, "i").test(prefix) : false;
    if (prefix && !hasName) return { context: prefix, body: m[2]!.trim() };
  }
  return { context: "", body };
}

const isNoise = (s: string) => GREETING_ONLY.test(s.trim());

function buildPrompt(task: string, context: string, extras: string[]): string {
  const detail = [task, ...extras].join("，");
  return context ? `背景：${context}\n任务：${detail}` : detail;
}

/** 点名规则：返回 null 表示没有任何有效点名。 */
function planByName(body: string, context: string, roster: Roster): { tasks: PlannedTask[]; incomplete: Bot[] } | null {
  const segs = body.split(STRONG_SPLIT).map((s) => s.trim()).filter(Boolean);
  interface Item { bots: Bot[]; task: string; extras: string[] }
  const items: Item[] = [];
  const leading: string[] = [];
  let orphans: string[] = [];
  const incomplete: Bot[] = [];

  for (const seg of segs) {
    const parsed = analyzeWithConjunctions(seg, roster);
    if (!parsed) {
      orphans.push(seg);
      continue;
    }
    for (const p of parsed) {
      let task = p.task;
      if (task) {
        // 点名前的无主片段：开头的算背景，其余算上一项的补充说明
        if (items.length === 0) leading.push(...orphans.filter((o) => !isNoise(o)));
        else items[items.length - 1]!.extras.push(...orphans);
      } else if (orphans.length) {
        task = orphans.join("，");
      }
      orphans = [];
      if (task) items.push({ bots: p.bots, task, extras: [] });
      else incomplete.push(...p.bots);
    }
  }
  if (orphans.length && items.length) items[items.length - 1]!.extras.push(...orphans);
  if (items.length === 0 && incomplete.length === 0) return null;

  const ctx = [context, ...leading].filter(Boolean).join("，");
  const tasks = items.flatMap((it) =>
    it.bots.map((bot) => ({ bot, title: makeTitle(it.task), prompt: buildPrompt(it.task, ctx, it.extras) })),
  );
  return { tasks, incomplete };
}

// ───────────────────────── 关键字路由（未点名） ─────────────────────────

const ROLE_KEYWORDS: Array<[Role, RegExp]> = [
  ["office", /文档|表格|日程|会议|邮件|日历|提醒|幻灯|ppt|excel|word|周报|纪要/gi],
  ["research", /调研|搜索|搜一下|搜集|检索|查资料|查一下|查找|竞品|资料|research|search/gi],
  ["claude", /分析|写作|审查|评审|总结|方案|文章|报告|翻译|润色|review|梳理|文案/gi],
  ["code", /代码|bug|接口|测试|重构|实现|编译|报错|函数|脚本|单测|调试|api|修复|崩溃|fix|refactor|test|lint|commit|部署|数据库|迁移/gi],
];

function routeByKeyword(seg: string): { role: Role; score: number } | null {
  let best: Role | null = null;
  let bestScore = 0;
  // 平局时靠前的角色优先（“审查代码”应归 claude 系）
  for (const [role, re] of ROLE_KEYWORDS) {
    const score = seg.match(re)?.length ?? 0;
    if (score > bestScore) {
      best = role;
      bestScore = score;
    }
  }
  return best ? { role: best, score: bestScore } : null;
}

/** 内置角色关键字 vs 用户自建成员特征：自建成员更专精，分数不低于关键字命中数时优先。 */
function routeSegment(seg: string, roster: Roster): Bot | undefined {
  const byRole = routeByKeyword(seg);
  const roleBot = byRole ? roster.byRole(byRole.role) : undefined;
  const custom = roster.matchCustom(seg);
  if (custom && (custom.score >= 2 || !roleBot) && custom.score >= (roleBot && byRole ? byRole.score : 0)) return custom.bot;
  return roleBot;
}

function planByKeyword(body: string, context: string, roster: Roster): PlannedTask[] {
  const segs = body.split(STRONG_SPLIT).map((s) => s.trim()).filter(Boolean);
  interface Item { bot: Bot; tasks: string[]; extras: string[] }
  const items: Item[] = [];
  const leading: string[] = [];
  let orphans: string[] = [];
  for (const seg of segs) {
    const bot = routeSegment(seg, roster);
    if (!bot) {
      orphans.push(seg);
      continue;
    }
    const last = items[items.length - 1];
    if (last && last.bot.id === bot.id) {
      // 连续几句落到同一个 Bot：合成一个任务
      last.extras.push(...orphans, seg);
    } else {
      if (!last) leading.push(...orphans.filter((o) => !isNoise(o)));
      else last.extras.push(...orphans);
      items.push({ bot, tasks: [seg], extras: [] });
    }
    orphans = [];
  }
  if (orphans.length && items.length) items[items.length - 1]!.extras.push(...orphans);
  const ctx = [context, ...leading].filter(Boolean).join("，");
  return items.map((it) => {
    const task = cleanLead(it.tasks[0]!) || it.tasks[0]!;
    return { bot: it.bot, auto: true, title: makeTitle(task), prompt: buildPrompt(task, ctx, it.extras) };
  });
}

// ───────────────────────── 对外入口 ─────────────────────────

export const DISPATCH_REPLY = "好的，我来安排一下：";

/** 点名规则（快路径）。没有可分发内容时返回 null。 */
export function planNamed(text: string, bots: Bot[]): Plan | null {
  const roster = buildRoster(bots);
  const { context, body } = splitContext(text, roster);
  const named = planByName(body, context, roster);
  if (!named) return null;
  if (named.tasks.length === 0) {
    const who = [...new Set(named.incomplete.map((b) => b.name))].join("、");
    return { reply: `想让${who}做什么呢？比如：「交给${named.incomplete[0]?.name ?? "小码"}修登录 bug」。`, tasks: [] };
  }
  return { reply: DISPATCH_REPLY, tasks: named.tasks };
}

/**
 * 用户是否明确指派了某个成员（“交给小码…”“让阿克…”“阿克：…”）。
 * 配置了模型时只有这种明确点名才走规则快路径，含糊的点名交给模型判断。
 */
export function hasExplicitName(text: string, bots: Bot[]): boolean {
  const roster = buildRoster(bots);
  if (!roster.re) return false;
  const names = roster.re.source;
  return new RegExp(`(?:${GIVE}|${ASK})\\s*(?:${names})|(?:${names})\\s*[：:]`, "i").test(text);
}

/** 关键字路由（兜底）。没有命中时 tasks 为空。 */
export function planByKeywords(text: string, bots: Bot[]): PlannedTask[] {
  const roster = buildRoster(bots);
  const { context, body } = splitContext(text, roster);
  if (CHITCHAT.test(body.trim())) return [];
  return planByKeyword(body, context, roster);
}

/** 完整规则决策：点名 > 关键字 > 闲聊。 */
export function planByRules(text: string, bots: Bot[]): Plan {
  const named = planNamed(text, bots);
  if (named) return named;
  const tasks = planByKeywords(text, bots);
  if (tasks.length) return { reply: keywordReply(tasks), tasks };
  return { reply: chitchatReply(text, bots), tasks: [] };
}

export function keywordReply(tasks: PlannedTask[]): string {
  const notes = tasks.filter((t) => t.auto).map((t) => `「${t.title}」没指定人选，我按内容交给了${t.bot.name}。`);
  return [DISPATCH_REPLY, ...notes].join("\n");
}

export function chitchatReply(text: string, bots: Bot[]): string {
  const crew = bots.filter((b) => b.kind !== "main");
  const a = crew[0]?.name ?? "小码";
  const b = crew[1]?.name ?? "阿克";
  const hint = `我只负责分发，不亲自动手。可以这样说：「交给${a}修登录 bug，让${b}写退款接口」，没点名的话我会按内容挑人。`;
  if (/^(?:你好|您好|嗨|hi|hello)/i.test(text.trim())) return `你好，我是 Pip。${hint}`;
  if (/谢谢|多谢/.test(text)) return "不客气。有新任务随时告诉我。";
  return `这件事我暂时没法分发出去。${hint}`;
}
