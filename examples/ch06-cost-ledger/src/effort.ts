/**
 * 投入的账：从代码量和 git 历史能读出什么、读不出什么。
 *
 * 数字都是【实机】量的（口径见 measure.ts），对应正文 6.5、6.6 的表。
 * 这里只做两件事：把数字放在一起，以及判断「这段历史能不能拿来估投入」。
 */

export interface RepoFacts {
	readonly name: string;
	readonly commit: string;
	/** 统一口径的 TS 源码行数 */
	readonly lines: number;
	/** 其中与 pi 某个 blob 逐字节相同的行数；没有 pi 代码时为 0 */
	readonly piIdenticalLines: number;
	/** 非 merge commit 数 */
	readonly commits: number;
	/** 不同作者邮箱数（非 merge） */
	readonly authors: number;
	/** 「作者 × ISO 周」去重后的个数，排除名字里带 bot 的账号；粗略的人力代理 */
	readonly authorWeeks: number;
	readonly firstDay: string;
	readonly lastDay: string;
	/** 历史中新增行数最多的那一个 commit 带进来的行数（导入快照时就是那次导入）；measure.ts 量的就是它 */
	readonly largestImportLines: number;
	/** 统一口径下，历史上累计加的行数和删的行数 */
	readonly added: number;
	readonly deleted: number;
}

/** 2026-10-05 在各家基准 commit 上量的（见 research/BASELINE.md） */
export const REPOS: readonly RepoFacts[] = [
	{ name: "pi", commit: "b79e4cc8", lines: 123_629, piIdenticalLines: 123_629, commits: 5_508, authors: 310, authorWeeks: 654, firstDay: "2025-08-09", lastDay: "2026-08-28", largestImportLines: 18_097, added: 386_013, deleted: 260_739 },
	{ name: "Step-Code", commit: "7dd66cb9", lines: 147_766, piIdenticalLines: 24_922, commits: 14, authors: 8, authorWeeks: 8, firstDay: "2026-09-22", lastDay: "2026-09-24", largestImportLines: 147_386, added: 148_557, deleted: 791 },
	{ name: "minimax-code", commit: "89c930a2", lines: 677_790, piIdenticalLines: 61_348, commits: 69, authors: 7, authorWeeks: 10, firstDay: "2026-06-01", lastDay: "2026-09-21", largestImportLines: 676_878, added: 678_443, deleted: 653 },
	{ name: "kimi-code", commit: "65ae3e36", lines: 369_202, piIdenticalLines: 793, commits: 1_590, authors: 59, authorWeeks: 197, firstDay: "2026-05-22", lastDay: "2026-09-20", largestImportLines: 108_953, added: 678_379, deleted: 306_464 },
	{ name: "deepseek-harness", commit: "21638c56", lines: 417_501, piIdenticalLines: 0, commits: 12_061, authors: 65, authorWeeks: 295, firstDay: "2026-06-10", lastDay: "2026-09-27", largestImportLines: 12_259, added: 825_559, deleted: 401_284 },
	{ name: "ZCode", commit: "29628c9a", lines: 855_581, piIdenticalLines: 0, commits: 3, authors: 2, authorWeeks: 2, firstDay: "2026-09-20", lastDay: "2026-09-23", largestImportLines: 829_887, added: 856_983, deleted: 1_746 },
];

/** 新增最多的那一个 commit 占现有代码的比例超过这个值，历史就只是一段「公开之后」的投影 */
export const PROJECTION_THRESHOLD = 0.5;

export type HistoryVerdict = "usable" | "projection";

export interface EffortReading {
	readonly name: string;
	readonly ownLines: number;
	readonly importShare: number;
	readonly history: HistoryVerdict;
	readonly days: number;
	/** 只有 history 可用时才有：每个作者周新增多少行、删除占新增的比例、扣掉删除后每个作者周净增多少行 */
	readonly addedPerAuthorWeek?: number;
	readonly churn?: number;
	readonly netPerAuthorWeek?: number;
	readonly why: string;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

export function readEffort(r: RepoFacts): EffortReading {
	if (r.lines <= 0) throw new RangeError(`${r.name}：行数必须是正数`);
	const ownLines = r.lines - r.piIdenticalLines;
	const importShare = r.largestImportLines / r.lines;
	const days = daysBetween(r.firstDay, r.lastDay);
	if (importShare > PROJECTION_THRESHOLD) {
		return {
			name: r.name,
			ownLines,
			importShare,
			history: "projection",
			days,
			why: `最大的一个 commit 带进 ${(importShare * 100).toFixed(1)}% 的现有代码：commit 数和日期只描述公开之后`,
		};
	}
	return {
		name: r.name,
		ownLines,
		importShare,
		history: "usable",
		days,
		addedPerAuthorWeek: r.added / r.authorWeeks,
		churn: r.deleted / r.added,
		netPerAuthorWeek: (r.added - r.deleted) / r.authorWeeks,
		why: `历史从小起步（最大的一个 commit 只占 ${(importShare * 100).toFixed(1)}%），可以看增长和返工`,
	};
}

export interface EffortEstimate {
	readonly basis: string;
	readonly authorWeeks: number;
}

/**
 * 【推断】用可用历史的净增速度，反推写出 newLines 行要多少作者周。
 * 每段可用历史给一个数，不取平均：几个数差多远，本身就是结论的一部分。
 */
export function estimateAuthorWeeks(newLines: number, readings: readonly EffortReading[]): EffortEstimate[] {
	if (!(Number.isFinite(newLines) && newLines > 0)) throw new RangeError("newLines 必须是正数");
	return readings
		.filter((r) => r.history === "usable" && r.netPerAuthorWeek! > 0)
		.map((r) => ({ basis: r.name, authorWeeks: newLines / r.netPerAuthorWeek! }));
}
