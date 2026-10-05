import { strict as assert } from "node:assert";
import { test } from "node:test";

import { compactionBreakEvenTurns, DEFAULT_SCENARIO, simulateCompaction, summaryCap, validateScenario } from "../src/compaction.ts";
import { DEMO_PRICES } from "../src/pricing.ts";

const SONNET = DEMO_PRICES["anthropic/claude-sonnet-4-5"]!;
const never = { ...DEFAULT_SCENARIO, compact: false, contextWindow: Number.MAX_SAFE_INTEGER };

test("摘要上限 = floor(0.8 × reserve)，再和模型 maxTokens 取小", () => {
	assert.equal(summaryCap(16_384), 13_107);
	assert.equal(summaryCap(24_576), 19_660);
	assert.equal(summaryCap(16_384, 8_192), 8_192);
	assert.equal(summaryCap(16_384, 0), 13_107, "maxTokens 不是正数时不参与");
});

test("validateScenario：负数、reserve 不小于窗口、压完还在触发线以上，都拒绝", () => {
	assert.deepEqual(validateScenario(DEFAULT_SCENARIO), []);
	assert.ok(validateScenario({ ...DEFAULT_SCENARIO, turns: -1 }).some((p) => p.includes("turns")));
	assert.ok(validateScenario({ ...DEFAULT_SCENARIO, reserveTokens: 200_000 }).some((p) => p.includes("reserveTokens")));
	assert.ok(validateScenario({ ...DEFAULT_SCENARIO, keepRecentTokens: 180_000 }).some((p) => p.includes("触发线")));
	assert.throws(() => simulateCompaction({ ...DEFAULT_SCENARIO, turns: -1 }, SONNET), RangeError);
});

test("默认场景：200 轮压 5 次，prompt 峰值不超过窗口，比从不压缩便宜一半以上", () => {
	const r = simulateCompaction(DEFAULT_SCENARIO, SONNET);
	const n = simulateCompaction(never, SONNET);
	assert.equal(r.compactions, 5);
	assert.ok(r.peakPrompt <= DEFAULT_SCENARIO.contextWindow);
	assert.equal(n.compactions, 0);
	assert.equal(n.peakPrompt, 8_000 + 200 * 4_000);
	assert.ok(r.total < n.total / 2);
	assert.ok(Math.abs(r.total - (r.turnCost + r.summaryCost)) < 1e-9);
});

test("会话不够长时，压缩反而更贵", () => {
	const s = { ...DEFAULT_SCENARIO, turns: 50 };
	assert.ok(simulateCompaction(s, SONNET).total > simulateCompaction({ ...never, turns: 50 }, SONNET).total);
});

test("没触发压缩：两种模拟完全一样，也没有重写溢价", () => {
	const s = { ...DEFAULT_SCENARIO, turns: 20 };
	const r = simulateCompaction(s, SONNET);
	assert.equal(r.compactions, 0);
	assert.equal(r.rewritePremium, 0);
	assert.ok(Math.abs(r.total - simulateCompaction({ ...never, turns: 20 }, SONNET).total) < 1e-9);
});

test("摘要想写多长超过上限时被截断，并计数", () => {
	const r = simulateCompaction({ ...DEFAULT_SCENARIO, desiredSummaryTokens: 15_000 }, SONNET);
	assert.equal(r.summariesCapped, r.compactions);
	assert.equal(simulateCompaction({ ...DEFAULT_SCENARIO, desiredSummaryTokens: 15_000, reserveTokens: 24_576 }, SONNET).summariesCapped, 0);
});

test("回本轮数：默认场景十几轮，是正数", () => {
	const turns = compactionBreakEvenTurns(DEFAULT_SCENARIO, SONNET);
	assert.ok(turns > 10 && turns < 20, String(turns));
});
