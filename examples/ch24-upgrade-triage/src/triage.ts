// 三方分诊：基线、我们、上游新版三份清单，逐个路径判断该怎么处理。
// 只比摘要，不看内容——这一步要回答的是「哪些文件要人看」，不是「怎么合」。

import { type FileState, type Manifest, NEEDS_HUMAN, type TriagedFile } from "./types.ts";

function classify(base: string | undefined, ours: string | undefined, next: string | undefined): FileState | undefined {
  if (base === undefined) {
    if (ours === undefined) return next === undefined ? undefined : "upstream-added";
    if (next === undefined) return "ours-added";
    return ours === next ? "same-change" : "conflict";
  }
  if (ours === undefined) {
    if (next === undefined) return "both-deleted";
    return next === base ? "ours-deleted" : "ours-deleted-upstream-changed";
  }
  if (next === undefined) return ours === base ? "upstream-deleted" : "deleted-but-ours-modified";
  if (ours === base) return next === base ? "untouched" : "take-upstream";
  if (next === base) return "keep-ours";
  return ours === next ? "same-change" : "conflict";
}

/** 三份清单必须用同一套路径坐标。我们这份挪过目录的话，先用 relocate 挪回去 */
export function triage(base: Manifest, ours: Manifest, next: Manifest): TriagedFile[] {
  const paths = [...new Set([...base.keys(), ...ours.keys(), ...next.keys()])].sort();
  return paths.flatMap((path) => {
    const state = classify(base.get(path), ours.get(path), next.get(path));
    return state ? [{ path, state }] : [];
  });
}

export interface Move {
  readonly from: string;
  readonly to: string;
}

/**
 * 找「原样挪走」的文件：基线里有、我们这里同路径没有，但别的路径上有一份摘要完全相同的。
 * 摘要在两边都必须唯一才算——内容相同的文件有好几份时猜不出谁挪到了哪。
 * 挪走之后又改过的文件摘要对不上，这里找不到，仍然会落进 ours-deleted。
 */
export function detectMoves(base: Manifest, ours: Manifest): Move[] {
  const unique = (entries: Array<[string, string]>): Map<string, string> => {
    const count = new Map<string, number>();
    for (const [, digest] of entries) count.set(digest, (count.get(digest) ?? 0) + 1);
    return new Map(entries.filter(([, digest]) => count.get(digest) === 1).map(([path, digest]) => [digest, path]));
  };
  const gone = unique([...base].filter(([path]) => !ours.has(path)));
  const arrived = unique([...ours].filter(([path]) => !base.has(path)));
  return [...gone]
    .flatMap(([digest, from]) => (arrived.has(digest) ? [{ from, to: arrived.get(digest) as string }] : []))
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** 把我们这份清单里挪过的路径改回上游的路径，返回新清单 */
export function relocate(ours: Manifest, moves: readonly Move[]): Manifest {
  const back = new Map(moves.map((m) => [m.to, m.from]));
  return new Map([...ours].map(([path, digest]) => [back.get(path) ?? path, digest]));
}

/** 整个目录改名：把 to 前缀换回 from 前缀。前缀按目录边界匹配 */
export function relocatePrefix(ours: Manifest, prefixes: readonly Move[]): Manifest {
  const dir = (p: string): string => (p.endsWith("/") ? p : `${p}/`);
  const rename = (path: string): string => {
    const hit = prefixes.find((p) => path.startsWith(dir(p.to)));
    return hit ? dir(hit.from) + path.slice(dir(hit.to).length) : path;
  };
  return new Map([...ours].map(([path, digest]) => [rename(path), digest]));
}

export type Tally = ReadonlyMap<FileState, number>;

export function tally(files: readonly TriagedFile[]): Tally {
  const counts = new Map<FileState, number>();
  for (const f of files) counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
  return counts;
}

export const needsHuman = (files: readonly TriagedFile[]): TriagedFile[] => files.filter((f) => NEEDS_HUMAN.has(f.state));
