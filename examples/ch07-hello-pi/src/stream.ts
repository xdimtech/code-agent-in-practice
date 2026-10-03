/**
 * 把一次 Plan 展开成 provider 必须吐出的事件序列。
 *
 * 形状照 ai/src/types.ts:535 的 AssistantMessageEvent 联合体，顺序照
 * agent-loop.ts:316 起的 switch：先 start，再若干 delta，最后 done。
 * 这里不依赖 pi-ai 的类型，事件用普通对象表示，扩展那边再贴上去。
 *
 * 关键约束（modes/json-event.ts:23-30）：toolcall_start 事件的 partial 里，
 * contentIndex 指向的那一项必须已经是 toolCall。所以推事件之前先把内容块
 * 放进消息里，而不是只把事件排好序。
 */

import { planNextTurn, stopReasonFor, type Plan, type ScriptOptions } from "./script.ts";
import type { Context } from "./types.ts";

export interface ScriptedUsage {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly totalTokens: number;
}

export interface ScriptedCost {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly total: number;
}

export const ZERO_COST: ScriptedCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
export const ZERO_USAGE: ScriptedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 助手消息的草稿。pi 要求 provider 在流里一路带着它，delta 是增量。 */
export interface AssistantDraft {
	readonly role: "assistant";
	content: unknown[];
	readonly api: string;
	readonly provider: string;
	readonly model: string;
	readonly usage: ScriptedUsage & { readonly cost: ScriptedCost };
	stopReason: string;
	readonly timestamp: number;
}

/** 每一轮都要一份新的草稿：content 不能跨轮累积，否则 contentIndex 会对不上。 */
export function createAssistantDraft(model: { api: string; provider: string; id: string }): AssistantDraft {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { ...ZERO_USAGE, cost: ZERO_COST },
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

/** 事件的载荷，字段名与 pi 的一致；partial 指向下面那份草稿。 */
export type ScriptedEvent =
	| { readonly type: "start"; readonly partial: AssistantDraft }
	| { readonly type: "text_start"; readonly contentIndex: number; readonly partial: AssistantDraft }
	| {
			readonly type: "text_delta";
			readonly contentIndex: number;
			readonly delta: string;
			readonly partial: AssistantDraft;
	  }
	| { readonly type: "text_end"; readonly contentIndex: number; readonly partial: AssistantDraft }
	| { readonly type: "toolcall_start"; readonly contentIndex: number; readonly partial: AssistantDraft }
	| {
			readonly type: "toolcall_end";
			readonly contentIndex: number;
			readonly toolCall: unknown;
			readonly partial: AssistantDraft;
	  }
	| { readonly type: "done"; readonly reason: string; readonly message: AssistantDraft };

/**
 * 一轮的全部事件，按顺序返回。返回前 content 已经填好，所以 toolcall_start
 * 后面的 json-event 转换能读到 toolCall。
 *
 * 单独成函数是为了能在测试里数事件、查顺序，不必跑真的流。
 */
export function eventsForTurn(
	draft: AssistantDraft,
	context: Context,
	options: ScriptOptions = {},
): readonly ScriptedEvent[] {
	const plan: Plan = planNextTurn(context, options);
	const events: ScriptedEvent[] = [{ type: "start", partial: draft }];

	if (plan.kind === "toolCall") {
		const toolCall = { type: "toolCall", id: plan.id, name: plan.name, arguments: plan.args };
		draft.content.push(toolCall);
		events.push({ type: "toolcall_start", contentIndex: 0, partial: draft });
		events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: draft });
	} else {
		const text = { type: "text", text: "" };
		draft.content.push(text);
		events.push({ type: "text_start", contentIndex: 0, partial: draft });
		// delta 是增量，partial 里是累计后的全文：两句都写对，pi 才能原样转发。
		text.text = plan.text;
		events.push({ type: "text_delta", contentIndex: 0, delta: plan.text, partial: draft });
		events.push({ type: "text_end", contentIndex: 0, partial: draft });
	}

	draft.stopReason = stopReasonFor(plan);
	events.push({ type: "done", reason: draft.stopReason, message: draft });
	return events;
}

/** 只跑一轮的情况下用得上的简写：造草稿、出事件、返回最终消息。 */
export function runOneTurn(context: Context, model: { api: string; provider: string; id: string }, options: ScriptOptions = {}) {
	const draft = createAssistantDraft(model);
	eventsForTurn(draft, context, options);
	return draft;
}
