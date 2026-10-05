/**
 * 价格与花费。
 *
 * calculateCost 和 pi 的 packages/ai/src/models.ts:878-898 是同一个公式，区别只有一处：
 * pi 就地改写 usage.cost 再返回它，这里返回一个新对象。
 */

import type { BaseRates, Cost, PriceBook, Rates, Usage } from "./types.ts";

/**
 * Anthropic 文档给的缓存倍率，都相对基础输入价（prompt-caching 页面，2026-10-05 抓取）。
 * 个别模型的读价倍率更低，这里取通用值。
 */
export const CACHE_MULTIPLIERS = { write5m: 1.25, write1h: 2, read: 0.1 } as const;

/** 由基础输入价和输出价推出一套 5 分钟缓存的价格 */
export function ratesFromBase(input: number, output: number): Rates {
	if (!(input > 0) || !(output > 0)) throw new RangeError(`价格必须是正数：input=${input} output=${output}`);
	return { input, output, cacheRead: input * CACHE_MULTIPLIERS.read, cacheWrite: input * CACHE_MULTIPLIERS.write5m };
}

/**
 * 本例用的示例价格（美元 / 百万 token）。只是为了让数字有量级，不是报价——
 * pi 的价格表在构建时从 models.dev 生成，不进仓库（.gitignore:11）。
 */
export const DEMO_PRICES: Readonly<Record<string, Rates>> = {
	"anthropic/claude-sonnet-4-5": ratesFromBase(3, 15),
	"anthropic/claude-opus-4-5": ratesFromBase(5, 25),
};

export const demoPriceBook: PriceBook = (provider, model) => DEMO_PRICES[`${provider}/${model}`];

/** 命中的最高阈值那一档；一档都没命中就用基础价 */
export function pickRates(rates: Rates, promptTokens: number): BaseRates {
	let best: BaseRates = rates;
	let threshold = -1;
	for (const tier of rates.tiers ?? []) {
		if (promptTokens > tier.inputTokensAbove && tier.inputTokensAbove > threshold) {
			best = tier;
			threshold = tier.inputTokensAbove;
		}
	}
	return best;
}

export function calculateCost(rates: Rates, usage: Omit<Usage, "cost" | "totalTokens">): Cost {
	const r = pickRates(rates, usage.input + usage.cacheRead + usage.cacheWrite);
	// 1 小时缓存写按 2 倍基础输入价计，其余缓存写按 cacheWrite 价
	const longWrite = usage.cacheWrite1h ?? 0;
	const input = (r.input / 1e6) * usage.input;
	const output = (r.output / 1e6) * usage.output;
	const cacheRead = (r.cacheRead / 1e6) * usage.cacheRead;
	const cacheWrite = (r.cacheWrite * (usage.cacheWrite - longWrite) + r.input * CACHE_MULTIPLIERS.write1h * longWrite) / 1e6;
	return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/** 构造一条完整的 usage（含 totalTokens 和 cost），给演示数据和测试用 */
export function makeUsage(rates: Rates, tokens: Omit<Usage, "cost" | "totalTokens">): Usage {
	const totalTokens = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
	return { ...tokens, totalTokens, cost: calculateCost(rates, tokens) };
}
