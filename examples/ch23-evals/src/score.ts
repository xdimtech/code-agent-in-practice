/**
 * 记分与对比：把一堆「跑了几次、每次多少分」汇总成一句「候选比基线好多少」。
 *
 * 两条规则是从下游抄来的，也值得照抄：
 *
 *   1. 分数 >= 1 算通过（`summary.ts:258`）。低于 1 是「观察到了什么」，不是失败。
 *   2. 同一组里必须基线、候选各恰好一条（`summary.ts:196-210`，记账在 `:164-194`）。多一条少一条都记账，
 *      不进对比——少一条多半是崩了，多一条多半是测试写重了，这两种都不该混进均值。
 *
 * 分数不是结论，差值也不是。6 次里 4:3 和 12 次里 8:6 看起来都是 +16.7 个百分点，
 * 但后者的可信度完全不同。所以报告里「配对几次」「谁赢几次」和差值一起写出来，
 * 由读的人自己判断够不够。
 */

import type { Observation } from "./types.ts";

export type { Observation };

export interface Metric {
	/** 能配成对的次数 */
	readonly pairs: number;
	readonly baselineMean: number | null;
	readonly candidateMean: number | null;
	readonly delta: number | null;
}

export interface Comparison {
	readonly evalSet: string;
	readonly baseline: string;
	readonly candidate: string;
	readonly baselinePassRate: number | null;
	readonly candidatePassRate: number | null;
	/** 通过率之差，乘 100 是百分点 */
	readonly lift: number | null;
	readonly baselineWins: number;
	readonly candidateWins: number;
	readonly ties: number;
	readonly tokens: Metric;
	readonly latencyMs: Metric;
	readonly costUsd: Metric;
}

export interface Diagnostic {
	readonly groupKey: string;
	readonly harness: string;
	readonly reason: "缺观测" | "重复观测" | "运行出错" | "没有分数";
}

export interface ComparisonReport {
	readonly comparisons: readonly Comparison[];
	readonly diagnostics: readonly Diagnostic[];
}

/** 一组观测里的重复次数，用来在报告里给读者一个样本量的感觉 */
export function repetitionsOf(observations: readonly Observation[]): number {
	const seen = new Set<number>();
	for (const observation of observations) seen.add(observation.repetition);
	return seen.size;
}

function meanOf(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 浮点减法会吐出 0.30000000000000004 这种尾巴，报告里不该看见 */
function precise(left: number, right: number): number {
	return Number((left - right).toPrecision(12));
}

function metricOf(pairs: ReadonlyArray<{ baseline?: Observation; candidate?: Observation }>, pick: (observation: Observation) => number | undefined): Metric {
	const baselineValues: number[] = [];
	const candidateValues: number[] = [];
	for (const pair of pairs) {
		const baselineValue = pair.baseline ? pick(pair.baseline) : undefined;
		const candidateValue = pair.candidate ? pick(pair.candidate) : undefined;
		if (baselineValue === undefined || candidateValue === undefined) continue;
		baselineValues.push(baselineValue);
		candidateValues.push(candidateValue);
	}
	const baselineMean = meanOf(baselineValues);
	const candidateMean = meanOf(candidateValues);
	return {
		pairs: baselineValues.length,
		baselineMean,
		candidateMean,
		delta: baselineMean === null || candidateMean === null ? null : precise(candidateMean, baselineMean),
	};
}

/**
 * 把观测按 (evalSet, groupKey, repetition) 分组，每组里每个 harness 只允许一条。
 * 比较的是「候选减基线」，而且是同一次输入、同一次重复里的两条，成对相减。
 */
export function compare(
	observations: readonly Observation[],
	options: { readonly baseline: string; readonly candidates: readonly string[] },
): ComparisonReport {
	const groups = new Map<string, Map<string, Observation[]>>();
	for (const observation of observations) {
		const groupId = JSON.stringify([observation.evalSet, observation.groupKey, observation.repetition]);
		const group = groups.get(groupId) ?? new Map<string, Observation[]>();
		const bucket = group.get(observation.harness) ?? [];
		bucket.push(observation);
		group.set(observation.harness, bucket);
		groups.set(groupId, group);
	}

	const diagnostics: Diagnostic[] = [];
	const comparisons: Comparison[] = [];
	const sortedGroups = [...groups.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

	for (const candidate of options.candidates) {
		const pairs: Array<{ baseline?: Observation; candidate?: Observation }> = [];
		const evalSets = new Set<string>();
		for (const [, group] of sortedGroups) {
			const baselineList = group.get(options.baseline) ?? [];
			const candidateList = group.get(candidate) ?? [];
			// 组里可能两边都没有（不该发生），拿任一边的第一条来定位是哪一组
			const anchor = baselineList[0] ?? candidateList[0];
			if (anchor) evalSets.add(anchor.evalSet);
			for (const [harness, list] of [
				[options.baseline, baselineList],
				[candidate, candidateList],
			] as const) {
				const first = list[0];
				if (!first) {
					if (anchor) diagnostics.push({ groupKey: anchor.groupKey, harness, reason: "缺观测" });
				} else if (list.length > 1) {
					diagnostics.push({ groupKey: first.groupKey, harness, reason: "重复观测" });
				} else if (first.errored) {
					diagnostics.push({ groupKey: first.groupKey, harness, reason: "运行出错" });
				} else if (first.score === undefined) {
					diagnostics.push({ groupKey: first.groupKey, harness, reason: "没有分数" });
				}
			}
			if (baselineList.length === 1 && candidateList.length === 1 && !baselineList[0].errored && !candidateList[0].errored) {
				pairs.push({ baseline: baselineList[0], candidate: candidateList[0] });
			}
		}

		let baselinePasses = 0;
		let candidatePasses = 0;
		let baselineWins = 0;
		let candidateWins = 0;
		let ties = 0;
		let scored = 0;
		for (const pair of pairs) {
			const baselineScore = pair.baseline?.score;
			const candidateScore = pair.candidate?.score;
			if (baselineScore === undefined || candidateScore === undefined) continue;
			scored += 1;
			const baselinePassed = baselineScore >= 1;
			const candidatePassed = candidateScore >= 1;
			if (baselinePassed) baselinePasses += 1;
			if (candidatePassed) candidatePasses += 1;
			if (baselinePassed === candidatePassed) ties += 1;
			else if (baselinePassed) baselineWins += 1;
			else candidateWins += 1;
		}

		const baselinePassRate = scored === 0 ? null : baselinePasses / scored;
		const candidatePassRate = scored === 0 ? null : candidatePasses / scored;
		comparisons.push({
			evalSet: [...evalSets].sort().join(" / ") || "(未知 eval 集)",
			baseline: options.baseline,
			candidate,
			baselinePassRate,
			candidatePassRate,
			lift: baselinePassRate === null || candidatePassRate === null ? null : precise(candidatePassRate, baselinePassRate),
			baselineWins,
			candidateWins,
			ties,
			tokens: metricOf(pairs, (observation) => observation.totalTokens),
			latencyMs: metricOf(pairs, (observation) => observation.totalMs),
			costUsd: metricOf(pairs, (observation) => observation.estimatedCostUsd),
		});
	}

	return { comparisons, diagnostics };
}

/** 中文字符在终端里占两列，按字符数补齐会让「耗时」和「token」对不齐 */
const LABEL_WIDTH = 8;
const displayWidth = (text: string): number => [...text].reduce((width, char) => width + ((char.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1), 0);
const padLabel = (label: string): string => `${" ".repeat(Math.max(0, LABEL_WIDTH - displayWidth(label)))}${label}`;

const percent = (value: number | null): string => (value === null ? "不可用" : `${(value * 100).toFixed(1)}%`);
const signed = (value: number, digits: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

interface MetricFormat {
	/** 数的写法，比如 `123.0` */
	readonly value: (value: number) => string;
	/** 跟在差值后面的单位，比如 ` token` */
	readonly unit: string;
}

/** 差值也按量纲写：符号放最前面，`+$0.0003` 而不是 `$+0.0003`，更不是被一位小数抹成 `+0.0` */
function signedWith(value: number, format: MetricFormat): string {
	return `${value >= 0 ? "+" : "-"}${format.value(Math.abs(value))}${format.unit}`;
}

function metricLine(label: string, metric: Metric, format: MetricFormat): string {
	if (metric.delta === null || metric.baselineMean === null || metric.candidateMean === null) {
		return `    ${padLabel(label)}  不可用（配对 ${metric.pairs}）`;
	}
	const coverage = `候选 ${format.value(metric.candidateMean)}${format.unit}，基线 ${format.value(metric.baselineMean)}${format.unit}，配对 ${metric.pairs}`;
	return `    ${padLabel(label)}  ${signedWith(metric.delta, format)}（${coverage}）`;
}

export function renderReport(report: ComparisonReport): string {
	if (report.comparisons.length === 0 && report.diagnostics.length === 0) return "";
	const lines: string[] = ["eval 对比"];
	for (const comparison of report.comparisons) {
		lines.push(`  ${comparison.evalSet}`);
		lines.push(`    ${padLabel("基线")}  ${comparison.baseline}`);
		lines.push(`    ${padLabel("候选")}  ${comparison.candidate}`);
		if (comparison.lift === null) {
			lines.push(`    ${padLabel("通过率")}  不可用`);
		} else {
			lines.push(
				`    ${padLabel("通过率")}  ${signed(comparison.lift * 100, 1)} 个百分点（候选 ${percent(comparison.candidatePassRate)}，基线 ${percent(comparison.baselinePassRate)}；候选赢 ${comparison.candidateWins}，基线赢 ${comparison.baselineWins}，平 ${comparison.ties}）`,
			);
		}
		lines.push(metricLine("token", comparison.tokens, { value: (value) => value.toFixed(1), unit: "" }));
		lines.push(metricLine("耗时", comparison.latencyMs, { value: (value) => value.toFixed(1), unit: "ms" }));
		lines.push(metricLine("费用", comparison.costUsd, { value: (value) => `$${value.toFixed(4)}`, unit: "" }));
	}
	if (report.diagnostics.length > 0) {
		lines.push("  没进对比的观测");
		for (const diagnostic of report.diagnostics) {
			lines.push(`    ${diagnostic.reason}：${diagnostic.groupKey} 的 ${diagnostic.harness}`);
		}
	}
	return lines.join("\n");
}
