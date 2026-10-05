import { strict as assert } from "node:assert";
import { test } from "node:test";

import { estimateAuthorWeeks, PROJECTION_THRESHOLD, readEffort, REPOS, type RepoFacts } from "../src/effort.ts";

const byName = (name: string) => readEffort(REPOS.find((r) => r.name === name)!);

test("一次导入带进大半代码的仓库：历史只是投影，不给人力数字", () => {
	for (const name of ["Step-Code", "minimax-code", "ZCode"]) {
		const r = byName(name);
		assert.equal(r.history, "projection", name);
		assert.ok(r.importShare > PROJECTION_THRESHOLD);
		assert.equal(r.addedPerAuthorWeek, undefined);
		assert.equal(r.churn, undefined);
	}
});

test("从小起步的仓库：给出每作者周新增和返工比例", () => {
	for (const name of ["pi", "kimi-code", "deepseek-harness"]) {
		const r = byName(name);
		assert.equal(r.history, "usable", name);
		assert.ok(r.addedPerAuthorWeek! > 0);
		assert.ok(r.churn! > 0.4 && r.churn! < 0.7);
	}
});

test("非 pi 行 = 总行数 − 与 pi 逐字节相同的行", () => {
	assert.equal(byName("pi").ownLines, 0);
	assert.equal(byName("kimi-code").ownLines, 369_202 - 793);
	assert.equal(byName("deepseek-harness").ownLines, 417_501);
});

test("天数含首尾；行数不是正数时报错", () => {
	assert.equal(byName("Step-Code").days, 3);
	const bad: RepoFacts = { ...REPOS[0]!, lines: 0 };
	assert.throws(() => readEffort(bad), RangeError);
});

test("反推作者周：只用可用历史，每段各给一个数，不取平均", () => {
	const est = estimateAuthorWeeks(57_343, REPOS.map(readEffort));
	assert.deepEqual(est.map((e) => e.basis), ["pi", "kimi-code", "deepseek-harness"]);
	const kimi = est.find((e) => e.basis === "kimi-code")!;
	assert.ok(Math.abs(kimi.authorWeeks - 57_343 / ((678_379 - 306_464) / 197)) < 1e-9);
	const pi = est.find((e) => e.basis === "pi")!;
	assert.ok(pi.authorWeeks > 5 * kimi.authorWeeks, "成熟项目的净增速度慢得多");
	assert.throws(() => estimateAuthorWeeks(0, []), RangeError);
});
