import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CACHE_MULTIPLIERS, calculateCost, makeUsage, pickRates, ratesFromBase } from "../src/pricing.ts";
import type { Rates } from "../src/types.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("ratesFromBase：缓存读 0.1 倍、5 分钟写 1.25 倍；非正价格直接报错", () => {
	const r = ratesFromBase(3, 15);
	close(r.cacheRead, 0.3);
	close(r.cacheWrite, 3.75);
	assert.throws(() => ratesFromBase(0, 15), RangeError);
	assert.throws(() => ratesFromBase(3, Number.NaN), RangeError);
});

test("calculateCost：四个分项各按自己的单价，total 是它们的和", () => {
	const c = calculateCost(ratesFromBase(3, 15), { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 400_000 });
	close(c.input, 3);
	close(c.output, 1.5);
	close(c.cacheRead, 0.6);
	close(c.cacheWrite, 1.5);
	close(c.total, 6.6);
});

test("calculateCost：1 小时缓存写按 2 倍基础输入价，其余照 5 分钟价", () => {
	const c = calculateCost(ratesFromBase(3, 15), { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000, cacheWrite1h: 400_000 });
	close(c.cacheWrite, 0.6 * 3.75 + 0.4 * 3 * CACHE_MULTIPLIERS.write1h);
});

test("pickRates：取命中的最高那一档，整次请求一起换价", () => {
	const rates: Rates = {
		...ratesFromBase(3, 15),
		tiers: [
			{ ...ratesFromBase(6, 22.5), inputTokensAbove: 200_000 },
			{ ...ratesFromBase(4, 18), inputTokensAbove: 100_000 },
		],
	};
	assert.equal(pickRates(rates, 50_000).input, 3);
	assert.equal(pickRates(rates, 150_000).input, 4);
	assert.equal(pickRates(rates, 250_000).input, 6);
	assert.equal(pickRates(rates, 200_000).input, 4, "阈值是「超过」，等于不算");
	close(calculateCost(rates, { input: 150_000, output: 0, cacheRead: 100_000, cacheWrite: 0 }).input, 0.9);
});

test("calculateCost 不改传进来的对象；makeUsage 补上 totalTokens 和 cost", () => {
	const tokens = Object.freeze({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 });
	const u = makeUsage(ratesFromBase(3, 15), tokens);
	assert.equal(u.totalTokens, 100);
	assert.equal((tokens as Record<string, unknown>).cost, undefined);
	close(u.cost.total, calculateCost(ratesFromBase(3, 15), tokens).total);
});
