// pi 的资源过滤规则（package-manager.ts:655-785），把 minimatch 换成 Node 自带的 path.posix.matchesGlob。
// 所有路径都是包根下的 POSIX 相对路径，比如 "skills/review/SKILL.md"。

import { posix } from "node:path";

/** 普通模式可以匹配相对路径或文件名；SKILL.md 还可以用它所在的目录来匹配（:655-681）。 */
export function matchesAnyPattern(path: string, patterns: readonly string[]): boolean {
  const name = posix.basename(path);
  const isSkill = name === "SKILL.md";
  const parent = posix.dirname(path);
  return patterns.some((pattern) => {
    if (posix.matchesGlob(path, pattern) || posix.matchesGlob(name, pattern)) return true;
    return isSkill && (posix.matchesGlob(parent, pattern) || posix.matchesGlob(posix.basename(parent), pattern));
  });
}

/** `+` 和 `-` 只认精确路径，不认 glob（:688-706）。 */
export function matchesAnyExactPattern(path: string, patterns: readonly string[]): boolean {
  const isSkill = posix.basename(path) === "SKILL.md";
  return patterns.some((pattern) => {
    const normalized = pattern.startsWith("./") ? pattern.slice(2) : pattern;
    return normalized === path || (isSkill && normalized === posix.dirname(path));
  });
}

export interface SplitPatterns {
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly forceIncludes: readonly string[];
  readonly forceExcludes: readonly string[];
}

export function splitPatterns(patterns: readonly string[]): SplitPatterns {
  const tail = (prefix: string) => patterns.filter((p) => p.startsWith(prefix)).map((p) => p.slice(1));
  return {
    includes: patterns.filter((p) => !/^[!+-]/.test(p)),
    excludes: tail("!"),
    forceIncludes: tail("+"),
    forceExcludes: tail("-"),
  };
}

/**
 * 四步，顺序固定（:739-785）：
 * 1. 有普通模式就只留匹配的，没有就全留；2. `!` 排除；3. `+` 从全集里加回；4. `-` 最后再删。
 * 所以 `-` 永远赢，`+` 能救回被 `!` 排除的，但救不回被 `-` 删掉的。
 */
export function applyPatterns(all: readonly string[], patterns: readonly string[]): ReadonlySet<string> {
  const { includes, excludes, forceIncludes, forceExcludes } = splitPatterns(patterns);
  const included = includes.length === 0 ? all : all.filter((p) => matchesAnyPattern(p, includes));
  const kept = excludes.length === 0 ? included : included.filter((p) => !matchesAnyPattern(p, excludes));
  const rescued = all.filter((p) => !kept.includes(p) && matchesAnyExactPattern(p, forceIncludes));
  return new Set([...kept, ...rescued].filter((p) => !matchesAnyExactPattern(p, forceExcludes)));
}

export const isOverridePattern = (entry: string): boolean => /^[!+-]/.test(entry);
export const hasGlob = (entry: string): boolean => entry.includes("*") || entry.includes("?");
