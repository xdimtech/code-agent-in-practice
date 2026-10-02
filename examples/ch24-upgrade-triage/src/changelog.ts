// 读 Keep a Changelog 风格的 CHANGELOG：每个版本一段，破坏性变更单独一个小节。
// 升级前要回答的第一个问题：从我们的版本到目标版本，上游声明了哪些破坏性变更。

import { changedPart, compareVersions, VersionError, parseVersion } from "./semver.ts";
import type { Release } from "./types.ts";

const RELEASE_HEADING = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?/;
/** 小节名只要以 Breaking 开头就算：同一份文件里 "Breaking Changes" 和 "Breaking" 两种写法都出现过 */
const BREAKING_HEADING = /^### (Breaking\b.*)$/i;

export interface ParsedChangelog {
  readonly releases: readonly Release[];
  /** 版本号认不出来的段（Unreleased 不算） */
  readonly skipped: readonly string[];
  /** 破坏性变更小节用过的标题写法 → 次数 */
  readonly breakingHeadings: ReadonlyMap<string, number>;
}

interface Draft {
  readonly version: string;
  readonly date: string;
  readonly line: number;
  readonly breaking: string[];
}

export function parseChangelog(text: string): ParsedChangelog {
  const releases: Draft[] = [];
  const skipped: string[] = [];
  const headings = new Map<string, number>();
  let current: Draft | undefined;
  let inBreaking = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const release = RELEASE_HEADING.exec(raw);
    if (release) {
      inBreaking = false;
      current = undefined;
      const [, version, date = ""] = release;
      if (version.toLowerCase() === "unreleased") return;
      if (!isVersion(version)) return void skipped.push(version);
      current = { version, date, line: i + 1, breaking: [] };
      releases.push(current);
      return;
    }
    if (raw.startsWith("### ")) {
      const b = BREAKING_HEADING.exec(raw);
      inBreaking = Boolean(b && current);
      if (b && current) headings.set(b[1], (headings.get(b[1]) ?? 0) + 1);
      return;
    }
    if (!inBreaking || !current) return;
    if (raw.startsWith("- ")) current.breaking.push(raw.slice(2).trim());
    else if (/^\s+\S/.test(raw) && current.breaking.length > 0) {
      const last = current.breaking.length - 1;
      current.breaking[last] = `${current.breaking[last]} ${raw.trim()}`;
    }
  });
  return { releases: releases.map((r) => ({ ...r, breaking: [...r.breaking] })), skipped, breakingHeadings: headings };
}

function isVersion(text: string): boolean {
  try {
    parseVersion(text);
    return true;
  } catch (error) {
    if (error instanceof VersionError) return false;
    throw error;
  }
}

const ascending = (releases: readonly Release[]): Release[] =>
  [...releases].sort((a, b) => compareVersions(a.version, b.version));

/** (from, to] 区间里的版本，从旧到新 */
export function between(releases: readonly Release[], from: string, to: string): Release[] {
  return ascending(releases).filter((r) => compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0);
}

export interface PatchBreak {
  readonly release: Release;
  readonly previous: string;
}

/** 只动了第三段、却带着破坏性变更的版本——「补丁版可以放心升」这条假设在这些版本上不成立 */
export function breaksInPatchReleases(releases: readonly Release[]): PatchBreak[] {
  const sorted = ascending(releases);
  return sorted.flatMap((release, i) => {
    if (i === 0 || release.breaking.length === 0) return [];
    const previous = sorted[i - 1].version;
    return changedPart(previous, release.version) === "patch" ? [{ release, previous }] : [];
  });
}

export const countBreaking = (releases: readonly Release[]): number =>
  releases.reduce((n, r) => n + r.breaking.length, 0);
