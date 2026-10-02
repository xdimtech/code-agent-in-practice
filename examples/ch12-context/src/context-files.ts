import type { ContextFile, Vfs } from "./types.ts";
import { dirname, isFile, join, readFile } from "./vfs.ts";

/** 同一目录下按这个顺序找，命中第一个就停——不是合并（resource-loader.ts:72）。 */
export const CONTEXT_CANDIDATES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"] as const;

export function loadContextFileFromDir(fs: Vfs, dir: string): ContextFile | undefined {
  for (const name of CONTEXT_CANDIDATES) {
    const path = join(dir, name);
    if (isFile(fs, path)) return { path, content: stripBom(readFile(fs, path)) };
  }
  return undefined;
}

/** 从 cwd 逐级走到根目录，返回的顺序是祖先在前、cwd 在后。 */
function ancestorDirs(cwd: string): readonly string[] {
  const dirs: string[] = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (dirname(dir) === dir) break;
  }
  return dirs.reverse();
}

/**
 * pi 的发现规则（resource-loader.ts:119-157）：
 * 全局 agentDir 一份在最前；再从根到 cwd，每层至多一份；同一路径只收一次。
 * 不看项目信任——docs/security.md:27 写明这是有意的。
 */
export function loadContextFiles(options: { fs: Vfs; cwd: string; agentDir: string }): readonly ContextFile[] {
  const { fs, cwd, agentDir } = options;
  const found = [agentDir, ...ancestorDirs(cwd)]
    .map((dir) => loadContextFileFromDir(fs, dir))
    .filter((file): file is ContextFile => file !== undefined);
  return found.filter((file, index) => found.findIndex((other) => other.path === file.path) === index);
}

export interface ContextBudget {
  readonly totalTokens: number;
  readonly perFile: readonly { readonly path: string; readonly tokens: number }[];
  readonly overBudget: boolean;
}

/** 本例新增：pi 对 AGENTS.md 不设上限，整份进 system prompt，每个请求都带着。 */
export function measureContextFiles(files: readonly ContextFile[], budgetTokens: number): ContextBudget {
  const perFile = files.map((file) => ({ path: file.path, tokens: estimateTokens(file.content) }));
  const totalTokens = perFile.reduce((sum, file) => sum + file.tokens, 0);
  return { totalTokens, perFile, overBudget: totalTokens > budgetTokens };
}

/** 与 pi 的 estimateTokens 同一量级的粗估：4 个字符约 1 个 token。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
