// 分支对比：找出每个维度上最优的分支，用于卡片上的差异高亮。纯函数。
import type { Branch } from "@muster/protocol";

export interface BranchVerdict {
  /** 测试全部通过且是最优。 */
  bestTests: boolean;
  /** 变更文件最少（改动最小）。 */
  fewestFiles: boolean;
  /** Token 最省。 */
  cheapest: boolean;
  /** 相对最省分支多花的 token（最省者为 0；任一方缺数据则 undefined）。 */
  tokensOver?: number;
  /** 相对改动最少分支多改的文件数。 */
  filesOver: number;
}

/** 少于 2 个分支、或所有分支在某维度完全相同时，该维度不高亮。 */
export function compareBranches(branches: Branch[]): Record<string, BranchVerdict> {
  const out: Record<string, BranchVerdict> = {};
  const multi = branches.length >= 2;
  const minFiles = Math.min(...branches.map((b) => b.filesChanged));
  const withTokens = branches.filter((b) => b.tokens !== undefined);
  const minTokens = withTokens.length ? Math.min(...withTokens.map((b) => b.tokens!)) : undefined;
  const tested = branches.filter((b) => b.tests);
  const score = (b: Branch) => (b.tests ? b.tests.passed - b.tests.failed * 1000 : -Infinity);
  const topScore = tested.length ? Math.max(...tested.map(score)) : -Infinity;
  const sameFiles = branches.every((b) => b.filesChanged === branches[0]?.filesChanged);
  const sameTokens = withTokens.every((b) => b.tokens === withTokens[0]?.tokens);
  const sameTests = tested.every((b) => score(b) === score(tested[0]!));
  for (const b of branches) {
    out[b.id] = {
      bestTests: multi && !sameTests && !!b.tests && b.tests.failed === 0 && score(b) === topScore,
      fewestFiles: multi && !sameFiles && b.filesChanged === minFiles,
      cheapest: multi && !sameTokens && minTokens !== undefined && b.tokens === minTokens,
      tokensOver: b.tokens !== undefined && minTokens !== undefined ? b.tokens - minTokens : undefined,
      filesOver: b.filesChanged - minFiles,
    };
  }
  return out;
}
