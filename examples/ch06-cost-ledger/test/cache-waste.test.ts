import { strict as assert } from "node:assert";
import { test } from "node:test";

import { detectMiss, isNoticeWorthy, NOISE_FLOOR_TOKENS, scanWaste } from "../src/cache-waste.ts";
import { DEMO_PRICES, demoPriceBook, makeUsage } from "../src/pricing.ts";
import { parseSession } from "../src/session.ts";
import { buildDemoSession } from "../src/demo.ts";
import type { AssistantTurn, LedgerEntry } from "../src/types.ts";

const SONNET = DEMO_PRICES["anthropic/claude-sonnet-4-5"]!;

function turn(id: string, cacheRead: number, cacheWrite: number, timestamp: number, model = "claude-sonnet-4-5", input = 0): AssistantTurn {
	return { id, provider: "anthropic", model, timestamp, usage: makeUsage(DEMO_PRICES[`anthropic/${model}`]!, { input, output: 100, cacheRead, cacheWrite }) };
}
const entry = (t: AssistantTurn): LedgerEntry => ({ kind: "assistant", turn: t });

test("全部命中：没有浪费", () => {
	const r = scanWaste([entry(turn("a", 0, 10_000, 0)), entry(turn("b", 10_000, 2_000, 1000))], demoPriceBook);
	assert.equal(r.misses.length, 0);
	assert.equal(r.missedTokens, 0);
});

test("漏掉的 token = min(上一轮 prompt, 这一轮 prompt) − 这一轮命中；单价差 = 实付 − 读价", () => {
	const r = scanWaste([entry(turn("a", 0, 10_000, 0)), entry(turn("b", 2_000, 10_000, 1000))], demoPriceBook);
	assert.equal(r.misses.length, 1);
	assert.equal(r.missedTokens, 8_000);
	assert.ok(Math.abs(r.missedCost - 8_000 * (SONNET.cacheWrite - SONNET.cacheRead) / 1e6) < 1e-12);
	assert.equal(r.misses[0]!.reason, "unknown");
});

test("漏得不到 1,024 算噪声：不计钱，只计轮数", () => {
	const r = scanWaste([entry(turn("a", 0, 10_000, 0)), entry(turn("b", 10_000 - NOISE_FLOOR_TOKENS, 2_000, 1000))], demoPriceBook);
	assert.equal(r.misses.length, 0);
	assert.equal(r.belowNoiseFloor, 1);
});

test("原因：换模型优先于空闲；空闲满 5 分钟才算 idle", () => {
	const prev = { promptTokens: 10_000, modelKey: "anthropic/claude-sonnet-4-5", timestamp: 0, reportedCache: true };
	const switched = detectMiss(prev, turn("b", 0, 12_000, 10 * 60_000, "claude-opus-4-5"), demoPriceBook);
	assert.ok(typeof switched === "object" && switched.reason === "model-switch");
	const idle = detectMiss(prev, turn("b", 0, 12_000, 5 * 60_000), demoPriceBook);
	assert.ok(typeof idle === "object" && idle.reason === "idle" && idle.idleMs === 300_000);
	const early = detectMiss(prev, turn("b", 0, 12_000, 5 * 60_000 - 1), demoPriceBook);
	assert.ok(typeof early === "object" && early.reason === "unknown");
});

test("压缩之后重新开始比：压缩后的第一轮不算漏", () => {
	const r = scanWaste([entry(turn("a", 0, 50_000, 0)), { kind: "compaction", id: "c", tokensBefore: 50_000 }, entry(turn("b", 0, 20_000, 1000))], demoPriceBook);
	assert.equal(r.misses.length, 0);
});

test("从没报过缓存的 provider：零缓存不算漏", () => {
	const noCache = (id: string, input: number, ts: number) => turn(id, 0, 0, ts, "claude-sonnet-4-5", input);
	const r = scanWaste([entry(noCache("a", 10_000, 0)), entry(noCache("b", 12_000, 1000))], demoPriceBook);
	assert.equal(r.misses.length, 0);
});

test("提示门槛：两万 token 或一角钱，满足一条就提示", () => {
	const base = { turnId: "x", idleMs: 0, reason: "unknown" as const };
	assert.equal(isNoticeWorthy({ ...base, missedTokens: 20_000, missedCost: 0 }), true);
	assert.equal(isNoticeWorthy({ ...base, missedTokens: 100, missedCost: 0.1 }), true);
	assert.equal(isNoticeWorthy({ ...base, missedTokens: 19_999, missedCost: 0.099 }), false);
});

test("演示会话：空闲、换模型、换回来各漏一次，另有一轮在噪声以内", () => {
	const { entries, problems } = parseSession(buildDemoSession());
	assert.deepEqual(problems, []);
	const r = scanWaste(entries, demoPriceBook);
	assert.deepEqual(r.misses.map((m) => [m.turnId, m.reason]), [["a06", "idle"], ["a09", "model-switch"], ["a11", "model-switch"]]);
	assert.equal(r.belowNoiseFloor, 1);
	assert.equal(r.missedTokens, 77_750);
});
