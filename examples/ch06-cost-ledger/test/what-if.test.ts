import { strict as assert } from "node:assert";
import { test } from "node:test";

import { buildDemoSession } from "../src/demo.ts";
import { DEMO_PRICES, demoPriceBook, makeUsage } from "../src/pricing.ts";
import { parseSession } from "../src/session.ts";
import type { LedgerEntry } from "../src/types.ts";
import { longRetentionBreakEven, MIN_CACHEABLE_TOKENS, POLICIES, recorded, replay } from "../src/what-if.ts";

const SONNET = DEMO_PRICES["anthropic/claude-sonnet-4-5"]!;
const [NONE, FIVE, HOUR] = POLICIES as [(typeof POLICIES)[0], (typeof POLICIES)[0], (typeof POLICIES)[0]];

function at(id: string, prompt: number, timestamp: number, model = "claude-sonnet-4-5"): LedgerEntry {
	return { kind: "assistant", turn: { id, provider: "anthropic", model, timestamp, usage: makeUsage(DEMO_PRICES[`anthropic/${model}`]!, { input: prompt, output: 0, cacheRead: 0, cacheWrite: 0 }) } };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("不缓存：所有 prompt 都按输入价", () => {
	close(replay([at("a", 10_000, 0), at("b", 12_000, 1000)], NONE, demoPriceBook).prompt, (22_000 * SONNET.input) / 1e6);
});

test("5 分钟档：TTL 内整段命中，只有新增部分按写入价", () => {
	const r = replay([at("a", 10_000, 0), at("b", 12_000, 60_000)], FIVE, demoPriceBook);
	close(r.prompt, (10_000 * SONNET.cacheWrite + 10_000 * SONNET.cacheRead + 2_000 * SONNET.cacheWrite) / 1e6);
	assert.equal(r.rewrites, 0);
});

test("超过 TTL：整段重写并计一次；1 小时档同样的停顿不重写", () => {
	const entries = [at("a", 10_000, 0), at("b", 12_000, 12 * 60_000)];
	assert.equal(replay(entries, FIVE, demoPriceBook).rewrites, 1);
	assert.equal(replay(entries, HOUR, demoPriceBook).rewrites, 0);
});

test("缓存按模型分开：换走再换回，原模型的前缀还在", () => {
	const r = replay([at("a", 10_000, 0), at("b", 11_000, 30_000, "claude-opus-4-5"), at("c", 12_000, 60_000)], FIVE, demoPriceBook);
	assert.equal(r.rewrites, 1, "只有第一次到 Opus 那一轮是整段重写");
});

test("压缩清掉所有缓存，之后第一轮不算重写；摘要的钱各策略一样算", () => {
	const summary = makeUsage(SONNET, { input: 20_000, output: 3_000, cacheRead: 0, cacheWrite: 0 });
	const entries: LedgerEntry[] = [at("a", 30_000, 0), { kind: "compaction", id: "c", tokensBefore: 30_000, usage: summary }, at("b", 15_000, 1000)];
	const five = replay(entries, FIVE, demoPriceBook);
	assert.equal(five.rewrites, 0);
	close(five.summaries, summary.cost.total);
	close(replay(entries, NONE, demoPriceBook).summaries, summary.cost.total);
});

test("短于最小可缓存长度的 prompt 不缓存，按输入价", () => {
	const r = replay([at("a", MIN_CACHEABLE_TOKENS - 1, 0)], FIVE, demoPriceBook);
	close(r.prompt, ((MIN_CACHEABLE_TOKENS - 1) * SONNET.input) / 1e6);
});

test("查不到价格就报错，不按 0 算", () => {
	assert.throws(() => replay([at("a", 10, 0)], FIVE, () => undefined), /价格/);
});

test("演示会话：5 分钟档约为不缓存的一半，1 小时档介于两者之间", () => {
	const { entries } = parseSession(buildDemoSession());
	const [none, five, hour] = POLICIES.map((p) => replay(entries, p, demoPriceBook)) as [ReturnType<typeof replay>, ReturnType<typeof replay>, ReturnType<typeof replay>];
	assert.ok(five.total < hour.total && hour.total < none.total);
	assert.ok(five.total / none.total > 0.5 && five.total / none.total < 0.55);
	assert.equal(five.rewrites, 2);
	assert.equal(hour.rewrites, 1);
	assert.ok(Math.abs(recorded(entries) - 1.27) < 0.005);
});

test("1 小时档打平点：停顿时的 prompt × 1.15 / 0.75", () => {
	close(longRetentionBreakEven(31_000), (31_000 * 1.15) / 0.75);
});
