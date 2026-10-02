// 文件是流水，会话是树。pi 把文件里最后一条当作叶子（core/session-manager.ts:964-967），
// 从叶子沿 parentId 走回根就是「当前这条对话」（:334-360）；不在这条路上的条目是被放弃的分支。
// 再叠一层压缩：上下文里只剩最近一次压缩的摘要、它保留的尾巴和它之后的条目（:418-454）。

import type { Entry } from "./types.ts";

export interface SessionTree {
  readonly byId: ReadonlyMap<string, Entry>;
  readonly leafId: string | undefined;
  /** 根 → 叶子 */
  readonly activePath: readonly Entry[];
  /** 文件里有、当前对话里没有的条目，按文件顺序 */
  readonly offPath: readonly Entry[];
  /** 被放弃的分支的末端：没有子条目、又不是当前叶子 */
  readonly abandonedLeaves: readonly string[];
  /** 发给模型的那部分，已考虑压缩 */
  readonly context: readonly Entry[];
  readonly duplicateIds: readonly string[];
  /** parentId 指向文件里不存在的条目；pi 会把它当根，前面的历史就悄悄断掉了 */
  readonly danglingParents: readonly { readonly id: string; readonly parentId: string }[];
  /** 沿 parentId 回走时绕回自己；pi 的回走没有防环（:352-357、:1265-1268） */
  readonly cycleAt: string | undefined;
}

function walkToRoot(byId: ReadonlyMap<string, Entry>, leafId: string | undefined): { path: Entry[]; cycleAt?: string } {
  const path: Entry[] = [];
  const seen = new Set<string>();
  let current = leafId === undefined ? undefined : byId.get(leafId);
  while (current) {
    if (seen.has(current.id)) return { path: path.reverse(), cycleAt: current.id };
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return { path: path.reverse() };
}

/** 从根走到任意一个条目；用来把被放弃的分支当成一条完整对话来读 */
export const pathTo = (tree: Pick<SessionTree, "byId">, id: string): Entry[] => walkToRoot(tree.byId, id).path;

export function contextEntries(path: readonly Entry[]): Entry[] {
  const compactionIdx = path.findLastIndex((e) => e.type === "compaction");
  if (compactionIdx < 0) return [...path];
  const compaction = path[compactionIdx]!;
  const keptFrom = path.findIndex((e, i) => i < compactionIdx && e.id === compaction.firstKeptEntryId);
  const kept = keptFrom < 0 ? [] : path.slice(keptFrom, compactionIdx);
  return [compaction, ...kept, ...path.slice(compactionIdx + 1)];
}

export function buildTree(entries: readonly Entry[]): SessionTree {
  const byId = new Map<string, Entry>();
  const duplicateIds: string[] = [];
  for (const e of entries) {
    if (byId.has(e.id)) duplicateIds.push(e.id); // pi 的 Map 后写覆盖前写，不报
    byId.set(e.id, e);
  }
  const leafId = entries.at(-1)?.id;
  const { path, cycleAt } = walkToRoot(byId, leafId);
  const onPath = new Set(path);
  const parents = new Set(entries.map((e) => e.parentId));
  return {
    byId,
    leafId,
    activePath: path,
    offPath: entries.filter((e) => !onPath.has(e)),
    abandonedLeaves: entries.filter((e) => !parents.has(e.id) && e.id !== leafId).map((e) => e.id),
    context: contextEntries(path),
    duplicateIds,
    danglingParents: entries
      .filter((e) => e.parentId !== null && !byId.has(e.parentId))
      .map((e) => ({ id: e.id, parentId: e.parentId as string })),
    cycleAt,
  };
}
