/**
 * 缓存浪费：上一轮已经付过钱的前缀，这一轮又按全价付了一次。
 *
 * 规则照抄 pi 的 core/cache-stats.ts:56-132，只是写成不改状态的 reduce：
 * - 上一轮的整段 prompt 都应该在缓存里；这一轮少读到的部分算「漏」
 * - 漏的不到 1,024 个 token 算断点粒度的噪声，不计
 * - 压缩和分支摘要之后上下文本来就变了，重新开始比；换模型不豁免，照算
 * - 从来没报过缓存数据的 provider，零缓存不算漏
 */

import type { AssistantTurn, LedgerEntry, PriceBook } from "./types.ts";

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const NOISE_FLOOR_TOKENS = 1024;
/** pi 在对话里提示的门槛：少于 2 万 token 且少于 1 角钱就不打扰（interactive-mode.ts:3842） */
export const NOTICE_MIN_TOKENS = 20_000;
export const NOTICE_MIN_COST = 0.1;

export type MissReason = "model-switch" | "idle" | "unknown";

export interface CacheMiss {
	readonly turnId: string;
	readonly missedTokens: number;
	readonly missedCost: number;
	readonly idleMs: number;
	readonly reason: MissReason;
}

export interface WasteReport {
	readonly misses: readonly CacheMiss[];
	readonly missedTokens: number;
	readonly missedCost: number;
	/** 漏了但低于噪声门槛、没计进去的轮数 */
	readonly belowNoiseFloor: number;
}

interface Previous {
	readonly promptTokens: number;
	readonly modelKey: string;
	readonly timestamp: number;
	readonly reportedCache: boolean;
}

const promptOf = (t: AssistantTurn) => t.usage.input + t.usage.cacheRead + t.usage.cacheWrite;
const keyOf = (t: AssistantTurn) => `${t.provider}/${t.model}`;

/** 一轮相对上一轮漏了多少；"noise" 表示漏了但在噪声门槛以内 */
export function detectMiss(prev: Previous | undefined, turn: AssistantTurn, prices: PriceBook): CacheMiss | "noise" | undefined {
	const u = turn.usage;
	const prompt = promptOf(turn);
	if (!prev || prompt <= 0 || (u.cacheRead + u.cacheWrite === 0 && !prev.reportedCache)) return undefined;
	const missedTokens = Math.min(prev.promptTokens, prompt) - u.cacheRead;
	if (missedTokens <= 0) return undefined;
	if (missedTokens <= NOISE_FLOOR_TOKENS) return "noise";
	// 漏掉的 token 只会落在 input 或 cacheWrite 里，所以「实付单价」直接用这一条消息自己的分项
	const paid = u.input + u.cacheWrite;
	const paidPerToken = paid > 0 ? (u.cost.input + u.cost.cacheWrite) / paid : 0;
	const readPerToken = u.cacheRead > 0 ? u.cost.cacheRead / u.cacheRead : (prices(turn.provider, turn.model)?.cacheRead ?? 0) / 1e6;
	const idleMs = Math.max(0, turn.timestamp - prev.timestamp);
	const reason: MissReason = keyOf(turn) !== prev.modelKey ? "model-switch" : idleMs >= CACHE_TTL_MS ? "idle" : "unknown";
	return { turnId: turn.id, missedTokens, missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken), idleMs, reason };
}

function nextPrevious(turn: AssistantTurn, prev: Previous | undefined): Previous | undefined {
	const prompt = promptOf(turn);
	if (prompt <= 0) return prev;
	const reported = (prev?.reportedCache ?? false) || turn.usage.cacheRead + turn.usage.cacheWrite > 0;
	return { promptTokens: prompt, modelKey: keyOf(turn), timestamp: turn.timestamp, reportedCache: reported };
}

export function scanWaste(entries: readonly LedgerEntry[], prices: PriceBook): WasteReport {
	const start = { prev: undefined as Previous | undefined, report: { misses: [], missedTokens: 0, missedCost: 0, belowNoiseFloor: 0 } as WasteReport };
	return entries.reduce((state, entry) => {
		if (entry.kind !== "assistant") return { ...state, prev: undefined };
		const miss = detectMiss(state.prev, entry.turn, prices);
		const r = state.report;
		const report: WasteReport =
			miss === "noise"
				? { ...r, belowNoiseFloor: r.belowNoiseFloor + 1 }
				: miss
					? { ...r, misses: [...r.misses, miss], missedTokens: r.missedTokens + miss.missedTokens, missedCost: r.missedCost + miss.missedCost }
					: r;
		return { prev: nextPrevious(entry.turn, state.prev), report };
	}, start).report;
}

/** pi 会不会在对话里把这一条漏提示出来 */
export const isNoticeWorthy = (miss: CacheMiss) => miss.missedTokens >= NOTICE_MIN_TOKENS || miss.missedCost >= NOTICE_MIN_COST;
