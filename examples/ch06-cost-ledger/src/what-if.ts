/**
 * 同一份会话，换一种缓存策略重算一遍要花多少。
 *
 * 只用会话里记下的「每一轮 prompt 多大、输出多少、什么时候发的、哪个模型」，
 * 不看它实际命中了多少，按策略重新推：
 * - 缓存按模型分开记：同一个模型上一次的 prompt 在 TTL 以内，就整段命中；新增的部分按写入价付
 * - 超过 TTL、或者这个模型从没用过：整段重写
 * - 压缩之后：整段重写（system 头部其实还能命中，这里不认，偏保守）
 * - prompt 短于最小可缓存长度时不缓存，全按输入价
 * 压缩和分支摘要那一次调用本身是 cacheRetention: "none"（compaction.ts:588-593），各策略一样算。
 */

import { CACHE_MULTIPLIERS, pickRates } from "./pricing.ts";
import type { LedgerEntry, PriceBook } from "./types.ts";

export interface RetentionPolicy {
	readonly name: string;
	/** undefined 表示不用缓存 */
	readonly ttlMs?: number;
	/** 写入价相对基础输入价的倍数 */
	readonly writeMultiplier: number;
}

export const POLICIES: readonly RetentionPolicy[] = [
	{ name: "none", writeMultiplier: 1 },
	{ name: "5m", ttlMs: 5 * 60 * 1000, writeMultiplier: CACHE_MULTIPLIERS.write5m },
	{ name: "1h", ttlMs: 60 * 60 * 1000, writeMultiplier: CACHE_MULTIPLIERS.write1h },
];

/**
 * Anthropic 文档：短于最小长度的 prompt 不会被缓存，而且不报错。门槛按模型不同，
 * Sonnet 4.5 是 1,024，Opus 4.5 是 4,096；演示会话的 prompt 都远大于两者，这里统一取 1,024
 */
export const MIN_CACHEABLE_TOKENS = 1024;

export interface PolicyCost {
	readonly policy: string;
	readonly prompt: number;
	readonly output: number;
	readonly summaries: number;
	readonly total: number;
	/** 缓存失效导致整段重写的轮数；会话第一轮和压缩后第一轮本来就是冷的，不算 */
	readonly rewrites: number;
}

/** 每个模型最近一次写进缓存的前缀长度和时间；缓存每用一次就续期 */
type Warm = Readonly<Record<string, { readonly prompt: number; readonly timestamp: number }>>;

export function replay(entries: readonly LedgerEntry[], policy: RetentionPolicy, prices: PriceBook): PolicyCost {
	const zero: PolicyCost = { policy: policy.name, prompt: 0, output: 0, summaries: 0, total: 0, rewrites: 0 };
	const start = { warm: {} as Warm, cost: zero };
	return entries.reduce((state, entry) => {
		const c = state.cost;
		if (entry.kind !== "assistant") {
			const s = entry.usage?.cost.total ?? 0;
			return { warm: {}, cost: { ...c, summaries: c.summaries + s, total: c.total + s } };
		}
		const t = entry.turn;
		const rates = prices(t.provider, t.model);
		if (!rates) throw new Error(`没有 ${t.provider}/${t.model} 的价格，算不了`);
		const prompt = t.usage.input + t.usage.cacheRead + t.usage.cacheWrite;
		const r = pickRates(rates, prompt);
		const key = `${t.provider}/${t.model}`;
		const p = state.warm[key];
		const live = policy.ttlMs !== undefined && p !== undefined && t.timestamp - p.timestamp <= policy.ttlMs;
		const cached = live ? Math.min(p.prompt, prompt) : 0;
		const cacheable = policy.ttlMs !== undefined && prompt >= MIN_CACHEABLE_TOKENS;
		const promptCost = cacheable ? (cached * r.cacheRead + (prompt - cached) * r.input * policy.writeMultiplier) / 1e6 : (prompt * r.input) / 1e6;
		const outputCost = (t.usage.output * r.output) / 1e6;
		const rewrote = cacheable && Object.keys(state.warm).length > 0 && !live;
		return {
			warm: { ...state.warm, [key]: { prompt, timestamp: t.timestamp } },
			cost: {
				...c,
				prompt: c.prompt + promptCost,
				output: c.output + outputCost,
				total: c.total + promptCost + outputCost,
				rewrites: c.rewrites + (rewrote ? 1 : 0),
			},
		};
	}, start).cost;
}

/** 会话里实际记下的花费，用来和重算的结果对照 */
export function recorded(entries: readonly LedgerEntry[]): number {
	return entries.reduce((sum, e) => sum + (e.kind === "assistant" ? e.turn.usage.cost.total : (e.usage?.cost.total ?? 0)), 0);
}

/**
 * 1 小时档什么时候划算：每次「5 到 60 分钟之间的停顿」省下一次整段重写，
 * 代价是此后每个新写入的 token 多付 (2 - 1.25) 倍输入价。返回打平所需的新写入 token 数。
 */
export function longRetentionBreakEven(promptAtPause: number): number {
	const saved = promptAtPause * (CACHE_MULTIPLIERS.write5m - CACHE_MULTIPLIERS.read);
	return saved / (CACHE_MULTIPLIERS.write1h - CACHE_MULTIPLIERS.write5m);
}
