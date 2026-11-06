// GitHub 事件源：用 gh CLI 调 Events API（已登录），解析为触发用的命中项。
import { execFile } from "node:child_process";

export type RunGh = (args: string[]) => Promise<string>;

export const defaultRunGh: RunGh = (args) =>
  new Promise((resolve, reject) => {
    execFile("gh", args, { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(stdout);
    });
  });

/** params.event 前缀 -> Events API 的 type。 */
const EVENT_TYPES: Record<string, string> = {
  pull_request: "PullRequestEvent",
  issues: "IssuesEvent",
  issue_comment: "IssueCommentEvent",
};

const ACTION_TEXT: Record<string, string> = {
  opened: "已打开",
  closed: "已关闭",
  reopened: "已重新打开",
  edited: "已编辑",
  ready_for_review: "可评审",
  synchronize: "有新提交",
  created: "有新评论",
};

export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isValidRepo(repo: string | undefined): repo is string {
  return !!repo && REPO_RE.test(repo);
}

export function parseGithubEvent(spec: string | undefined): { type: string; action: string } | null {
  const m = /^([a-z_]+)\.([a-z_]+)$/.exec(spec ?? "");
  const type = m?.[1] ? EVENT_TYPES[m[1]] : undefined;
  return type && m?.[2] ? { type, action: m[2] } : null;
}

export interface GithubHit {
  /** Events API 的事件 id（同一 repo+event 内唯一，用于去重）。 */
  id: string;
  /** 事件中心标题，如“GitHub · PR #128 已打开 · shop-api”。 */
  title: string;
  /** PR / Issue 标题（外部内容）。 */
  subject: string;
  /** 正文或评论内容（外部内容）。 */
  body: string;
  url?: string;
  label?: string;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** 从 Events API 的返回里挑出匹配 spec 的事件（保持原顺序：新的在前）。 */
export function matchGithubEvents(raw: unknown, repo: string, spec: { type: string; action: string }): GithubHit[] {
  if (!Array.isArray(raw)) return [];
  const repoShort = repo.split("/")[1] ?? repo;
  const hits: GithubHit[] = [];
  for (const item of raw) {
    const ev = obj(item);
    const payload = obj(ev.payload);
    if (str(ev.type) !== spec.type || str(payload.action) !== spec.action || ev.id === undefined) continue;
    const isPr = spec.type === "PullRequestEvent";
    const target = obj(isPr ? payload.pull_request : payload.issue);
    const number = payload.number ?? target.number;
    const label = str(obj(payload.label).name).slice(0, 40) || undefined;
    const kind = isPr ? "PR" : "Issue";
    const actionText = spec.action === "labeled" ? `已添加标签「${label ?? "?"}」` : (ACTION_TEXT[spec.action] ?? spec.action);
    hits.push({
      id: String(ev.id),
      title: `GitHub · ${kind} #${String(number)} ${actionText} · ${repoShort}`,
      subject: str(target.title),
      body: str(spec.type === "IssueCommentEvent" ? obj(payload.comment).body : target.body),
      url: str(spec.type === "IssueCommentEvent" ? obj(payload.comment).html_url : target.html_url) || undefined,
      label,
    });
  }
  return hits;
}
