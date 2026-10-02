// 升级分诊的全部词汇。三份快照：基线（我们当初拿的那版上游）、我们（基线 + 自己的改动）、上游新版。

/** 相对路径 → 内容摘要。摘要用什么算法不重要，只要三份用同一种 */
export type Manifest = ReadonlyMap<string, string>;

/**
 * 一个文件在三份快照里的处境。
 * - untouched：谁都没动
 * - take-upstream：只有上游改了，直接拿新版
 * - keep-ours：只有我们改了，保留
 * - same-change：两边改成了一样的内容——这条补丁上游已经有了，可以撤掉
 * - conflict：两边都改了且不一样，要人来合
 * - upstream-added / ours-added：基线里没有，某一边新加的
 * - upstream-deleted：上游删了，我们没动过，跟着删
 * - deleted-but-ours-modified：上游删了，我们却改过它
 * - ours-deleted：我们删了（或挪走了），上游没动
 * - ours-deleted-upstream-changed：我们删了（或挪走了），上游却改了它——改动可能要跟到新位置
 * - both-deleted：两边都删了
 */
export type FileState =
  | "untouched"
  | "take-upstream"
  | "keep-ours"
  | "same-change"
  | "conflict"
  | "upstream-added"
  | "ours-added"
  | "upstream-deleted"
  | "deleted-but-ours-modified"
  | "ours-deleted"
  | "ours-deleted-upstream-changed"
  | "both-deleted";

/** 需要人看的状态。其余的可以机械处理 */
export const NEEDS_HUMAN: ReadonlySet<FileState> = new Set([
  "conflict",
  "deleted-but-ours-modified",
  "ours-deleted-upstream-changed",
]);

export interface TriagedFile {
  readonly path: string;
  readonly state: FileState;
}

/** 补丁台账里的一条 */
export interface LedgerEntry {
  readonly line: number;
  readonly date: string;
  readonly title: string;
  /** 字段名 → 值，字段名统一成小写 */
  readonly fields: ReadonlyMap<string, string>;
  /** 条目里提到的文件路径（Files 字段 + 反引号里像路径的词） */
  readonly paths: readonly string[];
}

export type Severity = "error" | "warn" | "info";

export interface Finding {
  readonly severity: Severity;
  readonly rule: string;
  readonly message: string;
}

/** CHANGELOG 里的一个版本段 */
export interface Release {
  readonly version: string;
  readonly date: string;
  readonly line: number;
  /** 破坏性变更小节里的条目 */
  readonly breaking: readonly string[];
}
