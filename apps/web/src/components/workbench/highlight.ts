// 轻量语法着色：按行切词，不依赖任何库（工作台的 Markdown 代码块、diff、终端共用）。纯函数，便于测试。
export type TokenType = "kw" | "str" | "com" | "num" | "fn" | "type" | "plain";
export interface Token {
  type: TokenType;
  text: string;
}

const KEYWORDS = new Set(
  (
    "const let var function return if else for while do switch case break continue new class extends implements interface type enum import export from as default " +
    "async await try catch finally throw typeof instanceof in of void null undefined true false this super static public private protected readonly yield " +
    "def elif lambda pass with raise None True False and or not is global self print " +
    "fn pub mut impl struct use mod match loop where " +
    "func package go defer chan range nil " +
    "echo fi then done esac select from where insert update delete create table"
  ).split(" "),
);

const EXT_LANG: Record<string, string> = {
  ts: "ts", tsx: "ts", js: "ts", jsx: "ts", mjs: "ts", cjs: "ts", java: "ts", c: "ts", h: "ts", cpp: "ts", cs: "ts", go: "ts", rs: "ts", css: "ts", scss: "ts", vue: "ts",
  json: "json", jsonc: "json",
  py: "hash", rb: "hash", sh: "hash", bash: "hash", zsh: "hash", yml: "hash", yaml: "hash", toml: "hash", env: "hash", ps1: "hash", dockerfile: "hash",
  sql: "sql",
};
const ALIAS: Record<string, string> = { typescript: "ts", javascript: "ts", python: "hash", shell: "hash", sh: "hash", bash: "hash", yaml: "hash", yml: "hash", json: "json", sql: "sql", rust: "ts", go: "ts", java: "ts", css: "ts", tsx: "ts", jsx: "ts", js: "ts", ts: "ts", py: "hash", powershell: "hash", toml: "hash", c: "ts", cpp: "ts" };

/** 语言名（```ts）或文件路径 -> 着色家族。未知返回 "ts"（C 风格注释，对大多数代码够用）。 */
export function langFamily(lang?: string | null, path?: string): "ts" | "hash" | "json" | "sql" {
  if (lang && ALIAS[lang.toLowerCase()]) return ALIAS[lang.toLowerCase()] as "ts" | "hash" | "json" | "sql";
  if (path) {
    const base = path.split(/[\\/]/).pop()!.toLowerCase();
    const ext = base.includes(".") ? base.split(".").pop()! : base;
    if (EXT_LANG[ext]) return EXT_LANG[ext] as "ts" | "hash" | "json" | "sql";
  }
  return "ts";
}

const STR = String.raw`"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|` + "`(?:\\\\.|[^`\\\\])*`?";
const COMMENT: Record<string, string> = {
  ts: String.raw`\/\/.*|\/\*.*?(?:\*\/|$)`,
  hash: String.raw`#.*`,
  sql: String.raw`--.*|\/\*.*?(?:\*\/|$)`,
  json: String.raw`(?!)`, // JSON 没有注释
};
const RES = new Map<string, RegExp>();
function regexFor(family: string): RegExp {
  let re = RES.get(family);
  if (!re) {
    re = new RegExp(`(${COMMENT[family]})|(${STR})|(\\b\\d[\\d_.]*\\b)|([A-Za-z_$][\\w$]*)(\\s*\\()?`, "gy");
    RES.set(family, re);
  }
  return re;
}

/** 把一行代码切成带类型的片段，拼回去等于原文。 */
export function highlightLine(line: string, family: "ts" | "hash" | "json" | "sql" = "ts"): Token[] {
  const out: Token[] = [];
  const re = regexFor(family);
  const push = (type: TokenType, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let pos = 0;
  while (pos < line.length) {
    re.lastIndex = pos;
    const m = re.exec(line);
    if (m) {
      if (m[1] !== undefined) push("com", m[0]);
      else if (m[2] !== undefined) push("str", m[0]);
      else if (m[3] !== undefined) push("num", m[0]);
      else {
        const word = m[4]!;
        const kw = family === "sql" ? KEYWORDS.has(word.toLowerCase()) : KEYWORDS.has(word);
        if (kw) push("kw", word);
        else if (m[5] !== undefined) push("fn", word);
        else if (/^[A-Z]/.test(word)) push("type", word);
        else push("plain", word);
        if (m[5] !== undefined) push("plain", m[5]);
      }
      pos += m[0].length;
    } else {
      push("plain", line[pos]!);
      pos += 1;
    }
  }
  return out;
}

export const TOKEN_CLASS: Record<TokenType, string> = {
  kw: "text-lavender-deep font-medium",
  str: "text-mint-deep",
  com: "text-ink-faint italic",
  num: "text-amber-deep",
  fn: "text-sky-deep",
  type: "text-coral-deep",
  plain: "",
};
