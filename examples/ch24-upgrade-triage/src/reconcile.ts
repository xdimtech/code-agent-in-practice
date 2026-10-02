// 对账：台账说改了什么，三方分诊说实际改了什么，两边对一遍。
// 台账漏记的改动，升级时没人知道它为什么在那儿；台账记了但上游已经有了的，可以撤。

import type { FileState, Finding, LedgerEntry, TriagedFile } from "./types.ts";

/**
 * 一条补丁在这次升级里的去向。
 * - rework：它改的文件上游也改了（或删了），要重新落到新版上
 * - carry：上游没碰这些文件，补丁原样带过去
 * - drop：两边改成了一样的内容，上游已经有了，撤掉
 * - stale：台账记着，但文件和基线一模一样——补丁不在树里
 * - unlinked：条目里没有能对上的文件路径
 *
 * 文件没被任何条目点名时分两档：连它所在的包都没有条目提到，是错误；
 * 有条目提到了那个包，是提醒——知道大概是哪批补丁，但不知道是哪一条。
 */
export type Fate = "rework" | "carry" | "drop" | "stale" | "unlinked";

export interface EntryFate {
  readonly entry: LedgerEntry;
  readonly files: readonly TriagedFile[];
  readonly fate: Fate;
}

export interface Reconciliation {
  readonly fates: readonly EntryFate[];
  readonly findings: readonly Finding[];
}

const REWORK: ReadonlySet<FileState> = new Set(["conflict", "deleted-but-ours-modified"]);
const LOCAL_CHANGE: ReadonlySet<FileState> = new Set(["keep-ours", "conflict", "deleted-but-ours-modified", "same-change"]);
const PACKAGE_DIR = /`([\w.\-]+(?:\/[\w.\-]+)+)\/?`/g;

const suffixMatch = (file: string, mentioned: string): boolean => file === mentioned || file.endsWith(`/${mentioned}`);

/** 台账里常只写 `src/types.ts`，好几个包里都有。用条目的 Affected package 字段缩小范围 */
function packageDirs(entry: LedgerEntry): string[] {
  const scope = entry.fields.get("affected package") ?? entry.fields.get("affected packages") ?? "";
  return [...scope.matchAll(PACKAGE_DIR)].map((m) => m[1]);
}

const under = (path: string, dirs: readonly string[]): boolean => dirs.some((d) => path.startsWith(`${d}/`) || path.includes(`/${d}/`));

function link(entry: LedgerEntry, files: readonly TriagedFile[]): TriagedFile[] {
  const dirs = packageDirs(entry);
  const inScope = (path: string): boolean => under(path, dirs);
  const hits = entry.paths.flatMap((mentioned) => {
    const all = files.filter((f) => suffixMatch(f.path, mentioned));
    const narrowed = all.filter((f) => inScope(f.path));
    return all.length > 1 && narrowed.length > 0 ? narrowed : all;
  });
  return [...new Map(hits.map((f) => [f.path, f])).values()];
}

function fateOf(files: readonly TriagedFile[]): Fate {
  if (files.length === 0) return "unlinked";
  if (files.some((f) => REWORK.has(f.state))) return "rework";
  if (files.some((f) => f.state === "keep-ours" || f.state === "ours-added")) return "carry";
  return files.every((f) => f.state === "same-change") ? "drop" : "stale";
}

export function reconcile(entries: readonly LedgerEntry[], files: readonly TriagedFile[]): Reconciliation {
  const fates = entries.map((entry): EntryFate => {
    const linked = link(entry, files);
    return { entry, files: linked, fate: fateOf(linked) };
  });
  const ledgered = new Set(fates.flatMap((f) => f.files.map((t) => t.path)));
  const where = (f: EntryFate): string => `第 ${f.entry.line} 行「${f.entry.title.slice(0, 40)}」`;
  const packages = entries.flatMap(packageDirs);
  const unnamed = files.filter((f) => LOCAL_CHANGE.has(f.state) && !ledgered.has(f.path));
  const findings: Finding[] = [
    ...unnamed
      .filter((f) => !under(f.path, packages))
      .map((f): Finding => ({ severity: "error", rule: "unledgered-change", message: `${f.path} 和基线不一样（${f.state}），台账里没有哪一条提到它` })),
    ...unnamed
      .filter((f) => under(f.path, packages))
      .map((f): Finding => ({ severity: "warn", rule: "package-level-only", message: `${f.path} 和基线不一样（${f.state}），台账只记到了它所在的包，没点名这个文件` })),
    ...fates.filter((f) => f.fate === "stale").map((f): Finding => ({ severity: "warn", rule: "stale-entry", message: `${where(f)} 提到的文件和基线完全一样` })),
    ...fates.filter((f) => f.fate === "unlinked").map((f): Finding => ({ severity: "info", rule: "unlinked-entry", message: `${where(f)} 没有能对上的文件路径` })),
  ];
  return { fates, findings };
}

export function fateCounts(fates: readonly EntryFate[]): ReadonlyMap<Fate, number> {
  const counts = new Map<Fate, number>();
  for (const f of fates) counts.set(f.fate, (counts.get(f.fate) ?? 0) + 1);
  return counts;
}
