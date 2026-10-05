/**
 * 会话文件里和钱有关的那一小部分类型，字段名照抄 pi（packages/ai/src/types.ts:382-403、:803-818）。
 * 只取算账用得上的字段，其余的一律不认。
 */

export interface Cost {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly total: number;
}

export interface Usage {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	/** 只有 Anthropic 会把 1 小时缓存写单独报出来 */
	readonly cacheWrite1h?: number;
	readonly totalTokens: number;
	readonly cost: Cost;
}

/** 每百万 token 的美元价格 */
export interface BaseRates {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
}

/** 长上下文阶梯：整次请求的输入超过阈值时，整次换一套价格 */
export interface Rates extends BaseRates {
	readonly tiers?: readonly (BaseRates & { readonly inputTokensAbove: number })[];
}

export interface AssistantTurn {
	readonly id: string;
	readonly provider: string;
	readonly model: string;
	readonly usage: Usage;
	/** 毫秒时间戳，取消息自己的 timestamp（pi 用它算空闲时长） */
	readonly timestamp: number;
}

/** 会话里与算账有关的三种条目；其余条目读进来时就丢掉 */
export type LedgerEntry =
	| { readonly kind: "assistant"; readonly turn: AssistantTurn }
	| { readonly kind: "compaction"; readonly id: string; readonly tokensBefore: number; readonly usage?: Usage }
	| { readonly kind: "branch_summary"; readonly id: string; readonly usage?: Usage };

/** 按 `provider/model` 查价格；查不到返回 undefined */
export type PriceBook = (provider: string, model: string) => Rates | undefined;
