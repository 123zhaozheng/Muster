// 原生 Bot 的补充工具：ls / grep（只读，归入 files 组）与 web_fetch（web 组）。
// pi-durable 自带 read/write/edit/bash；这里只补它没有的，并给出“工具组 → 工具名”的映射。
import { defineExtension, defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { getOrThrow, type ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { Context } from "@earendil-works/chord/context";
import type { NativeToolGroup } from "@muster/protocol";
import { CODING_TOOLS } from "./extension";

/** 各工具组包含的工具名；write/edit/bash 的审批由 extension.ts 的 beforeTool 钩子统一处理。 */
export const GROUP_TOOLS: Record<NativeToolGroup, readonly string[]> = {
  files: ["read", "ls", "grep"],
  edit: ["write", "edit"],
  shell: ["bash"],
  web: ["web_fetch"],
};

/** 未指定 bot.tools 时的默认工具组（等同一期：读写文件 + 命令；联网需显式开启）。 */
export const DEFAULT_TOOL_GROUPS: readonly NativeToolGroup[] = ["files", "edit", "shell"];

const LIST_LIMIT = 500;
const GREP_MATCH_LIMIT = 100;
const GREP_FILE_LIMIT = 3000;
const GREP_FILE_BYTES = 1_000_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".venv", "__pycache__"]);
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_BODY_BYTES = 2_000_000;
export const WEB_DEFAULT_CHARS = 20_000;
export const WEB_MAX_CHARS = 50_000;

type Result = { output: { type: "text"; text: string }[]; isError?: boolean };
const text = (value: string, isError = false): Result => ({ output: [{ type: "text", text: value }], ...(isError ? { isError } : {}) });

function envOf(env: ExecutionEnv | undefined): ExecutionEnv {
  if (!env) throw new Error("当前会话没有可用的执行环境");
  return env;
}

export const lsTool = defineTool({
  name: "ls",
  description: "List the entries of a directory (default: the working directory). Directories end with '/'.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Directory to list (relative or absolute). Default: ." } },
    additionalProperties: true,
  },
  async execute(args, api, context) {
    const env = envOf(api.env);
    const { path } = args as { path?: string };
    const dir = getOrThrow(await env.absolutePath(path || ".", context));
    const entries = getOrThrow(await env.listDir(dir, context)).sort((a, b) => a.name.localeCompare(b.name));
    const lines = entries.slice(0, LIST_LIMIT).map((e) => (e.kind === "directory" ? `${e.name}/` : e.name));
    if (entries.length > LIST_LIMIT) lines.push(`…（共 ${entries.length} 项，仅显示前 ${LIST_LIMIT} 项）`);
    return text(lines.length ? lines.join("\n") : "(空目录)");
  },
});

export const grepTool = defineTool({
  name: "grep",
  description:
    "Search file contents with a regular expression. Searches recursively under `path` (default: the working directory), skipping node_modules, .git and large files. Returns `file:line: text` matches.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for" },
      path: { type: "string", description: "File or directory to search (default: .)" },
      ignoreCase: { type: "boolean", description: "Case-insensitive match" },
    },
    required: ["pattern"],
    additionalProperties: true,
  },
  async execute(args, api, context) {
    const env = envOf(api.env);
    const { pattern, path, ignoreCase } = args as { pattern: string; path?: string; ignoreCase?: boolean };
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch (error) {
      return text(`正则表达式无效：${(error as Error).message}`, true);
    }
    const root = getOrThrow(await env.absolutePath(path || ".", context));
    const files = await collectFiles(env, root, context);
    const matches: string[] = [];
    let truncated = files.truncated;
    for (const file of files.paths) {
      if (context.abortSignal?.aborted) break;
      const content = await env.readTextFile(file, context);
      if (!content.ok) continue; // 二进制或无权限的文件直接跳过
      const lines = content.value.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i]!)) continue;
        matches.push(`${relative(root, file)}:${i + 1}: ${lines[i]!.slice(0, 300)}`);
        if (matches.length >= GREP_MATCH_LIMIT) {
          truncated = true;
          break;
        }
      }
      if (matches.length >= GREP_MATCH_LIMIT) break;
    }
    if (matches.length === 0) return text("没有匹配");
    if (truncated) matches.push(`…（结果已截断，最多 ${GREP_MATCH_LIMIT} 条）`);
    return text(matches.join("\n"));
  },
});

function relative(root: string, file: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const r = norm(root).replace(/\/$/, "");
  const f = norm(file);
  return f === r ? f.slice(f.lastIndexOf("/") + 1) : f.startsWith(`${r}/`) ? f.slice(r.length + 1) : f;
}

/** 递归收集 root 下的文本候选文件（root 本身是文件时只返回它）。 */
async function collectFiles(env: ExecutionEnv, root: string, context: Context): Promise<{ paths: string[]; truncated: boolean }> {
  const info = getOrThrow(await env.fileInfo(root, context));
  if (info.kind === "file") return { paths: [root], truncated: false };
  const paths: string[] = [];
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift()!;
    const listing = await env.listDir(dir, context);
    if (!listing.ok) continue;
    for (const entry of listing.value.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.kind === "directory") {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) queue.push(entry.path);
      } else if (entry.kind === "file" && entry.size <= GREP_FILE_BYTES) {
        if (paths.length >= GREP_FILE_LIMIT) return { paths, truncated: true };
        paths.push(entry.path);
      }
    }
  }
  return { paths, truncated: false };
}

export const webFetchTool = defineTool({
  name: "web_fetch",
  description:
    "Fetch a web page with HTTP GET and return its text (HTML is converted to plain text). Only http/https URLs. Output is truncated to max_chars.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "http:// or https:// URL" },
      max_chars: { type: "number", description: `Maximum characters to return (default ${WEB_DEFAULT_CHARS}, max ${WEB_MAX_CHARS})` },
    },
    required: ["url"],
    additionalProperties: true,
  },
  async execute(args, _api, context) {
    const { url, max_chars } = args as { url: string; max_chars?: number };
    return fetchPage(url, max_chars, context.abortSignal);
  },
});

export async function fetchPage(rawUrl: string, maxChars: number | undefined, abort?: AbortSignal): Promise<Result> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return text(`无效的 URL：${rawUrl}`, true);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return text(`只支持 http/https，收到 ${url.protocol}`, true);
  const limit = Math.min(Math.max(Math.floor(maxChars ?? WEB_DEFAULT_CHARS) || WEB_DEFAULT_CHARS, 200), WEB_MAX_CHARS);
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = abort ? AbortSignal.any([abort, timeout]) : timeout;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; MusterBot/1.0)", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
    });
    if (!res.ok) return text(`请求失败：HTTP ${res.status} ${res.statusText}`, true);
    const body = await readCapped(res, FETCH_BODY_BYTES);
    const type = res.headers.get("content-type") ?? "";
    const isHtml = /html/i.test(type) || /^\s*<(!doctype|html)/i.test(body.slice(0, 200));
    const content = isHtml ? htmlToText(body) : body;
    const clipped = content.length > limit ? `${content.slice(0, limit)}\n…（已截断，原文约 ${content.length} 字符）` : content;
    return text(clipped.trim() || "(页面没有可读文本)");
  } catch (error) {
    const reason = timeout.aborted ? `超时（${FETCH_TIMEOUT_MS / 1000}s）` : abort?.aborted ? "已取消" : errorText(error);
    return text(`抓取失败：${reason}`, true);
  }
}

function errorText(error: unknown): string {
  const e = error as { message?: string; cause?: { message?: string; code?: string } };
  return e.cause?.message ?? e.cause?.code ?? e.message ?? String(error);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return out + decoder.decode();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–" };

/** 简单的 HTML → 文本：去掉脚本样式，块级标签换行，解码常见实体。 */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|head|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|pre|blockquote|ul|ol|table)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  const decoded = decodeEntities(body)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  const head = title ? `标题：${decodeEntities(title).replace(/\s+/g, " ").trim()}\n\n` : "";
  return head + decoded.trim();
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** 带补充工具的扩展；与 CODING_TOOLS 一起装进 registry，按会话用 agent.tools 过滤。 */
export const NATIVE_TOOLS = defineExtension({ name: "muster-tools", tools: [lsTool, grepTool, webFetchTool] as ToolRegistration[] });

const ALL_TOOLS = new Map<string, ToolRegistration>(
  [...(CODING_TOOLS.tools ?? []), ...(NATIVE_TOOLS.tools ?? [])].map((t) => [t.name, t as ToolRegistration]),
);

/** 把工具组展开成要启用的工具（去重、保持顺序）。 */
export function toolsForGroups(groups: readonly NativeToolGroup[] | undefined): ToolRegistration[] {
  const names = new Set<string>();
  for (const group of groups ?? DEFAULT_TOOL_GROUPS) for (const name of GROUP_TOOLS[group] ?? []) names.add(name);
  return [...names].flatMap((name) => ALL_TOOLS.get(name) ?? []);
}
