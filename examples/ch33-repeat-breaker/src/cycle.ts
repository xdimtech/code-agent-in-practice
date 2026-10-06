/**
 * 交替检测（本例新增，对应研究底稿 §9.5 的第 9 条建议）。
 *
 * kimi-code 的主计数只看「紧挨着的上一次调用是不是同一个键」，所以 A B A B…… 每次都从 1 重新数，
 * 一步里并行发 [A, B]、每步都一样，也是同样的结果。这里看调用序列的尾巴：
 * 如果最后 period × repeats 个键按 period 为周期原样重复，而且一组里不全是同一个键，就算打转。
 */

export interface Cycle {
	readonly period: number;
	readonly repeats: number;
}

export function detectCycle(keys: readonly string[], maxPeriod: number, minRepeats: number): Cycle | undefined {
	for (let period = 2; period <= maxPeriod; period++) {
		const repeats = tailRepeats(keys, period);
		if (repeats >= minRepeats && new Set(keys.slice(-period)).size > 1) return { period, repeats };
	}
	return undefined;
}

/** 尾巴上按 period 重复了几整遍 */
function tailRepeats(keys: readonly string[], period: number): number {
	if (keys.length < period) return 0;
	let matched = period;
	while (matched < keys.length && keys[keys.length - 1 - matched] === keys[keys.length - 1 - matched + period]) matched++;
	return Math.floor(matched / period);
}

/** 只留检测需要的那段尾巴，历史不无限增长 */
export function trimHistory(keys: readonly string[], maxPeriod: number, minRepeats: number): readonly string[] {
	const keep = maxPeriod * (minRepeats + 1);
	return keys.length > keep ? keys.slice(-keep) : keys;
}
