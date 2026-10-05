/**
 * 压缩的账：参数化地模拟一个很长的会话，看压缩是在省钱还是在花钱。
 *
 * 规则取自 pi：
 * - 触发：contextTokens > contextWindow - reserveTokens（compaction.ts:235-238）
 * - 摘要请求：把要丢掉的那段历史序列化成文本发出去（不带工具和 agent 的 system），cacheRetention: "none"，
 *   全按输入价（:588-593、:683-693）；工具结果在序列化时截到 2,000 字符（utils.ts:89），所以这里的输入是上限
 * - 摘要输出上限：min(floor(0.8 × reserveTokens), model.maxTokens)（:672-675）；
 *   撞上上限的摘要（stopReason "length"）pi 判为失败、不落盘（:540-552）。这里把它当成「截到上限照用」，偏乐观，只计次数
 * - 压缩后上下文 = system + 摘要 + 最近 keepRecentTokens；之后第一轮只有 system 头部还能命中缓存
 * 每一轮都假设在 5 分钟以内发出（缓存不过期），只有压缩会打断前缀。
 */

import { calculateCost } from "./pricing.ts";
import type { Rates } from "./types.ts";

export interface CompactionScenario {
	readonly contextWindow: number;
	readonly reserveTokens: number;
	readonly keepRecentTokens: number;
	/** 工具定义 + system prompt，压缩前后都不变 */
	readonly systemTokens: number;
	/** 每轮新增进上下文的 token（工具结果 + 上一轮输出） */
	readonly growthPerTurn: number;
	readonly outputPerTurn: number;
	/** 模型想写多长的摘要；实际受 0.8 × reserve 截断 */
	readonly desiredSummaryTokens: number;
	readonly turns: number;
	/** false 表示窗口无限、永不压缩——反事实，用来对照 */
	readonly compact: boolean;
}

export const DEFAULT_SCENARIO: CompactionScenario = {
	contextWindow: 200_000,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
	systemTokens: 8_000,
	growthPerTurn: 4_000,
	outputPerTurn: 400,
	desiredSummaryTokens: 10_000,
	turns: 200,
	compact: true,
};

export interface CompactionResult {
	readonly compactions: number;
	readonly turnCost: number;
	/** 摘要请求本身的花费 */
	readonly summaryCost: number;
	/** 压缩后第一轮整段重写比「本来只读缓存」多付的钱 */
	readonly rewritePremium: number;
	readonly total: number;
	readonly peakPrompt: number;
	/** 摘要撞上上限的次数；pi 里这几次压缩会失败 */
	readonly summariesCapped: number;
}

export const summaryCap = (reserveTokens: number, modelMaxTokens = Number.POSITIVE_INFINITY) =>
	Math.min(Math.floor(0.8 * reserveTokens), modelMaxTokens > 0 ? modelMaxTokens : Number.POSITIVE_INFINITY);

export function validateScenario(s: CompactionScenario): string[] {
	const problems: string[] = [];
	for (const [key, value] of Object.entries(s)) {
		if (typeof value === "number" && !(Number.isFinite(value) && value >= 0)) problems.push(`${key} 必须是非负数`);
	}
	if (s.reserveTokens >= s.contextWindow) problems.push("reserveTokens 必须小于 contextWindow");
	if (s.systemTokens + s.keepRecentTokens + summaryCap(s.reserveTokens) >= s.contextWindow - s.reserveTokens) {
		problems.push("压缩后的上下文已经超过触发线，会每轮都压缩");
	}
	return problems;
}

const prompt = (rates: Rates, cached: number, fresh: number, output: number) =>
	calculateCost(rates, { input: 0, output, cacheRead: cached, cacheWrite: fresh }).total;

export function simulateCompaction(s: CompactionScenario, rates: Rates): CompactionResult {
	const problems = validateScenario(s);
	if (problems.length > 0) throw new RangeError(problems.join("；"));
	const cap = summaryCap(s.reserveTokens);
	const threshold = s.contextWindow - s.reserveTokens;
	type State = CompactionResult & { readonly context: number; readonly cached: number };
	const start: State = { compactions: 0, turnCost: 0, summaryCost: 0, rewritePremium: 0, total: 0, peakPrompt: 0, summariesCapped: 0, context: s.systemTokens, cached: 0 };
	const end = Array.from({ length: s.turns }).reduce<State>((st) => {
		const context = st.context + s.growthPerTurn;
		const fresh = context - st.cached;
		const cost = prompt(rates, st.cached, fresh, s.outputPerTurn);
		// 压缩打断前缀后，这一轮比「上一轮的前缀全部命中」多付的部分
		const premium = st.compactions > 0 && st.cached < st.context ? prompt(rates, st.cached, fresh, 0) - prompt(rates, st.context, context - st.context, 0) : 0;
		const next = { ...st, turnCost: st.turnCost + cost, rewritePremium: st.rewritePremium + premium, total: st.total + cost, peakPrompt: Math.max(st.peakPrompt, context), context, cached: context };
		if (!s.compact || context <= threshold) return next;
		const summary = Math.min(s.desiredSummaryTokens, cap);
		const summarized = context - s.systemTokens - s.keepRecentTokens;
		const summaryCost = calculateCost(rates, { input: summarized, output: summary, cacheRead: 0, cacheWrite: 0 }).total;
		return {
			...next,
			compactions: next.compactions + 1,
			summaryCost: next.summaryCost + summaryCost,
			total: next.total + summaryCost,
			summariesCapped: next.summariesCapped + (s.desiredSummaryTokens > cap ? 1 : 0),
			context: s.systemTokens + summary + s.keepRecentTokens,
			cached: s.systemTokens,
		};
	}, start);
	const { context: _c, cached: _k, ...result } = end;
	return result;
}

/**
 * 一次压缩多少轮之后回本：压缩的一次性成本（摘要请求 + 重写溢价）
 * 除以之后每轮少读的缓存（被摘要替掉的那段 × 读价）。
 */
export function compactionBreakEvenTurns(s: CompactionScenario, rates: Rates): number {
	const before = s.contextWindow - s.reserveTokens + 1;
	const summary = Math.min(s.desiredSummaryTokens, summaryCap(s.reserveTokens));
	const after = s.systemTokens + summary + s.keepRecentTokens;
	const oneOff =
		calculateCost(rates, { input: before - s.systemTokens - s.keepRecentTokens, output: summary, cacheRead: 0, cacheWrite: 0 }).total +
		prompt(rates, s.systemTokens, after - s.systemTokens, 0) -
		prompt(rates, after, 0, 0);
	const savedPerTurn = ((before - after) * rates.cacheRead) / 1e6;
	return oneOff / savedPerTurn;
}
