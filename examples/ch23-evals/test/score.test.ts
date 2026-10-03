import { strict as assert } from "node:assert";
import { test } from "node:test";

import { compare, renderReport, repetitionsOf } from "../src/score.ts";
import type { Observation } from "../src/types.ts";

const BASELINE = "baseline-write";
const CANDIDATE = "careful-write";

function observation(fields: Partial<Observation> & { readonly groupKey: string; readonly repetition: number; readonly harness: string }): Observation {
	return { evalSet: "工具边界", ...fields };
}

/** 一次典型的比较：三组，基线过 1 组，候选过 3 组 */
function typical(): Observation[] {
	const scores: Array<[string, number, number]> = [
		["hello-extension#0", 0, 1],
		["patch-existing#0", 1, 1],
		["escape-workspace#0", 0, 1],
	];
	const observations: Observation[] = [];
	for (const [groupKey, baseline, candidate] of scores) {
		observations.push(observation({ groupKey, repetition: 1, harness: BASELINE, score: baseline, totalTokens: 100, totalMs: 200, estimatedCostUsd: 0.001 }));
		observations.push(observation({ groupKey, repetition: 1, harness: CANDIDATE, score: candidate, totalTokens: 120, totalMs: 260, estimatedCostUsd: 0.0013 }));
	}
	return observations;
}

test("对比按组配对，通过率之差就是 lift", () => {
	const report = compare(typical(), { baseline: BASELINE, candidates: [CANDIDATE] });
	assert.equal(report.comparisons.length, 1);
	const comparison = report.comparisons[0];
	assert.equal(comparison.baselinePassRate, 1 / 3);
	assert.equal(comparison.candidatePassRate, 1);
	// lift 经过 precise() 去掉浮点尾巴，所以和 2/3 只在第 12 位有效数字上一致
	assert.equal(comparison.lift, Number((2 / 3).toPrecision(12)));
	assert.equal(comparison.candidateWins, 2);
	assert.equal(comparison.baselineWins, 0);
	assert.equal(comparison.ties, 1);
	assert.deepEqual(report.diagnostics, []);
});

test("分数 >= 1 才算通过：0.75 是「观察到了什么」，不是通过", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 0.75 }),
		observation({ groupKey: "g#0", repetition: 1, harness: CANDIDATE, score: 0.99 }),
	];
	const comparison = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] }).comparisons[0];
	assert.equal(comparison.baselinePassRate, 0);
	assert.equal(comparison.candidatePassRate, 0);
	assert.equal(comparison.ties, 1);
});

test("同一组的两次重复是两条独立观测，不被压成一条", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 0 }),
		observation({ groupKey: "g#0", repetition: 2, harness: BASELINE, score: 1 }),
		observation({ groupKey: "g#0", repetition: 1, harness: CANDIDATE, score: 1 }),
		observation({ groupKey: "g#0", repetition: 2, harness: CANDIDATE, score: 1 }),
	];
	const report = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] });
	assert.deepEqual(report.diagnostics, []);
	const comparison = report.comparisons[0];
	assert.equal(comparison.baselinePassRate, 0.5);
	assert.equal(comparison.candidatePassRate, 1);
	assert.equal(comparison.lift, 0.5);
	assert.equal(repetitionsOf(observations), 2);
});

test("缺一边就记账，不进对比——少一条多半是崩了", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 1 }),
		observation({ groupKey: "h#0", repetition: 1, harness: BASELINE, score: 0 }),
		observation({ groupKey: "h#0", repetition: 1, harness: CANDIDATE, score: 1 }),
	];
	const report = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] });
	assert.equal(report.comparisons[0].lift, 1);
	assert.deepEqual(report.diagnostics, [{ groupKey: "g#0", harness: CANDIDATE, reason: "缺观测" }]);
});

test("同一组同一边出现两条，也不进对比——多一条多半是测试写重了", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 1 }),
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 1 }),
		observation({ groupKey: "g#0", repetition: 1, harness: CANDIDATE, score: 1 }),
	];
	const report = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] });
	assert.deepEqual(report.diagnostics, [{ groupKey: "g#0", harness: BASELINE, reason: "重复观测" }]);
	assert.equal(report.comparisons[0].lift, null);
});

test("崩了的那一组不进均值，也不当 0 分", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 0, errored: true }),
		observation({ groupKey: "g#0", repetition: 1, harness: CANDIDATE, score: 1 }),
		observation({ groupKey: "h#0", repetition: 1, harness: BASELINE, score: 0 }),
		observation({ groupKey: "h#0", repetition: 1, harness: CANDIDATE, score: 1 }),
	];
	const report = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] });
	assert.deepEqual(report.diagnostics, [{ groupKey: "g#0", harness: BASELINE, reason: "运行出错" }]);
	// 只剩 h 组进了对比
	assert.equal(report.comparisons[0].lift, 1);
	assert.equal(report.comparisons[0].candidateWins, 1);
});

test("配对时一边没分，那对不进分数统计，但用量统计也一起跳过", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 1, totalTokens: 100 }),
		observation({ groupKey: "g#0", repetition: 1, harness: CANDIDATE, totalTokens: 120 }),
	];
	const comparison = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] }).comparisons[0];
	assert.deepEqual(comparison.baselinePassRate, null);
	assert.equal(comparison.tokens.pairs, 1);
	assert.equal(comparison.tokens.delta, 20);
});

test("一边没测用量时，用量按有测到的那几对算——缺席不是 0", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 1, totalTokens: 100, totalMs: 200 }),
		observation({ groupKey: "g#0", repetition: 1, harness: CANDIDATE, score: 1, totalTokens: 130, totalMs: 260 }),
		observation({ groupKey: "h#0", repetition: 1, harness: BASELINE, score: 0 }),
		observation({ groupKey: "h#0", repetition: 1, harness: CANDIDATE, score: 1 }),
	];
	const comparison = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] }).comparisons[0];
	// 通过率两对都算（基线 1/2，候选 2/2），用量只算测到了的那一对
	assert.equal(comparison.lift, 0.5);
	assert.equal(comparison.tokens.pairs, 1);
	assert.equal(comparison.tokens.delta, 30);
	assert.equal(comparison.latencyMs.delta, 60);
	assert.equal(comparison.costUsd.delta, null);
});

test("浮点尾巴被切掉：0.3 - 0.1 报出来就是 0.2", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 0.1, totalTokens: 0.1 }),
		observation({ groupKey: "g#0", repetition: 1, harness: CANDIDATE, score: 0.3, totalTokens: 0.3 }),
	];
	const comparison = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] }).comparisons[0];
	assert.equal(comparison.tokens.delta, 0.2);
});

test("多个候选各算各的", () => {
	const observations: Observation[] = [];
	for (const [groupKey, baseline, candidate, other] of [
		["g#0", 0, 1, 1],
		["h#0", 0, 1, 0],
	] as const) {
		observations.push(observation({ groupKey, repetition: 1, harness: BASELINE, score: baseline }));
		observations.push(observation({ groupKey, repetition: 1, harness: CANDIDATE, score: candidate }));
		observations.push(observation({ groupKey, repetition: 1, harness: "third-way", score: other }));
	}
	const report = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE, "third-way"] });
	assert.equal(report.comparisons.length, 2);
	assert.equal(report.comparisons[0].lift, 1);
	assert.equal(report.comparisons[1].lift, 0.5);
});

test("报告里写出配对次数和胜负，差值不单独出现", () => {
	const text = renderReport(compare(typical(), { baseline: BASELINE, candidates: [CANDIDATE] }));
	assert.ok(text.includes("工具边界"));
	assert.ok(text.includes("+66.7 个百分点"));
	assert.ok(text.includes("候选赢 2"));
	assert.ok(text.includes("配对 3"));
});

test("量纲写对：token 是数、耗时带 ms、费用带 $", () => {
	const text = renderReport(compare(typical(), { baseline: BASELINE, candidates: [CANDIDATE] }));
	assert.ok(text.includes("+20.0（候选 120.0，基线 100.0，配对 3）"));
	assert.ok(text.includes("+60.0ms"));
	assert.ok(text.includes("+$0.0003"));
});

test("中英文标签按终端列宽对齐：「耗时」和「token」的冒号后面在同一列", () => {
	const text = renderReport(compare(typical(), { baseline: BASELINE, candidates: [CANDIDATE] }));
	const columnOf = (label: string): number => {
		const line = text.split("\n").find((item) => item.trimStart().startsWith(`${label}  `));
		assert.ok(line, `报告里没有 ${label} 这一行`);
		const prefix = line.slice(0, line.indexOf(label) + label.length);
		return [...prefix].reduce((width, char) => width + ((char.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1), 0);
	};
	const columns = ["基线", "候选", "通过率", "token", "耗时", "费用"].map(columnOf);
	assert.deepEqual(new Set(columns).size, 1, `各行标签的右边界不在同一列：${columns.join(", ")}`);
});

test("没进对比的观测在报告里单列，不混进差值", () => {
	const observations = [
		observation({ groupKey: "g#0", repetition: 1, harness: BASELINE, score: 1 }),
		observation({ groupKey: "g#0", repetition: 1, harness: CANDIDATE, errored: true }),
	];
	const text = renderReport(compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] }));
	assert.ok(text.includes("没进对比的观测"));
	assert.ok(text.includes("运行出错：g#0 的 careful-write"));
	assert.ok(text.includes("不可用"));
});

test("什么都没有时报告是空串，不是一行光秃秃的标题", () => {
	assert.equal(renderReport({ comparisons: [], diagnostics: [] }), "");
});

test("不同 eval 集不会串到一起去", () => {
	const observations = [
		observation({ evalSet: "A", groupKey: "g#0", repetition: 1, harness: BASELINE, score: 0 }),
		observation({ evalSet: "A", groupKey: "g#0", repetition: 1, harness: CANDIDATE, score: 1 }),
		observation({ evalSet: "B", groupKey: "g#0", repetition: 1, harness: BASELINE, score: 1 }),
		observation({ evalSet: "B", groupKey: "g#0", repetition: 1, harness: CANDIDATE, score: 0 }),
	];
	const comparison = compare(observations, { baseline: BASELINE, candidates: [CANDIDATE] }).comparisons[0];
	// 两个集合各一对，一升一降，合起来是 0
	assert.equal(comparison.lift, 0);
	assert.equal(comparison.candidateWins, 1);
	assert.equal(comparison.baselineWins, 1);
	assert.equal(comparison.evalSet, "A / B");
});
