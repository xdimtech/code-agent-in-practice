/**
 * 第 1 章的最小实现：一个只会「说话 → 跑工具 → 再说话」的循环。
 *
 * 这个文件刻意不做任何与「代码」有关的事：它不知道 read 是什么、不知道
 * 目录结构、不知道什么叫编辑。它只知道三件事——
 *   1. 把上下文交给模型，模型回一条消息
 *   2. 如果消息里带工具调用，就跑它们，把结果做成消息塞回上下文
 *   3. 如果没有工具调用，这一轮结束；要不要再来一轮由外面决定
 *
 * pi 把这三件事写在 `packages/agent/src/agent-loop.ts`（794 行）里。
 * 这里的实现比它短得多，但两个循环的形状是一样的：外层管「还要不要再开一轮」，
 * 内层管「这一轮还有没有工具要跑」。
 */

import type {
	ContentBlock,
	Context,
	EventSink,
	Message,
	StopReason,
	Tool,
	ToolLookup,
	ToolResult,
} from "./types.ts";

/** 模型的回答。循环只关心 `content` 和 `stopReason` 两个字段。 */
export interface AssistantReply {
	readonly content: readonly ContentBlock[];
	readonly stopReason: StopReason;
}

/**
 * 模型这一步。做成函数参数而不是 interface，是因为真实的 pi 也是这么做的：
 * `agent-loop.ts` 收一个 `streamFunction`，换成脚本模型、假模型、真 provider
 * 都不需要改循环本身（对照 `packages/agent/src/agent-loop.ts:162`）。
 */
export type ModelFn = (context: Context) => AssistantReply;

export interface ToolCallRef {
	readonly id: string;
	readonly name: string;
	readonly arguments: Readonly<Record<string, unknown>>;
}

/** 循环停下来的原因。前四种 pi 都有，最后一种是本例自己加的保险，见 1.5。 */
export type StopKind =
	/** 模型没有工具调用，正常收尾。pi 在 `agent-loop.ts:269` 从这扇门出去。 */
	| "no_tool_calls"
	/** 这一批工具**全部**要求停。pi 里它和上一种走同一扇门（`agent-loop.ts:235` → 269）。 */
	| "tools_terminated"
	/** 模型报错或中止，循环立刻退出，不再问宿主（`agent-loop.ts:215-219`）。 */
	| "model_error"
	/** 一轮结束后，宿主（不是模型）决定不再继续（`agent-loop.ts:252-255`）。 */
	| "host_stopped"
	/** 撞上轮数上限。pi 的循环里没有这个开关，这是本例给自己上的保险。 */
	| "max_turns";

export interface LoopResult {
	readonly messages: readonly Message[];
	readonly stopKind: StopKind;
	readonly turns: number;
}

export interface RunLoopOptions {
	readonly model: ModelFn;
	readonly tools: readonly Tool[];
	/** 已有的历史。它们**不会**再被宣布一遍——没有对应的 message_end。 */
	readonly context: Context;
	/**
	 * 这一次新进来的消息（通常是用户刚说的那句话）。循环会先把它们宣布出去
	 * 再问模型，对照 `agent-loop.ts:112-115`。循环自己不造用户消息——
	 * 它不知道用户是谁，只负责「凡是这次进上下文的，都发一次 message_end」。
	 */
	readonly prompts?: readonly Message[];
	readonly emit?: EventSink;
	/**
	 * 每一轮结束后问宿主一句「还继续吗」——包括没有工具调用的那一轮。
	 * pi 的对应物是 `shouldStopAfterTurn`（`agent/src/types.ts:223`）。
	 */
	readonly shouldStopAfterTurn?: (state: { turn: number; messages: readonly Message[] }) => boolean;
	readonly maxTurns?: number;
}

/** 默认的工具结果 → 消息。字段名照 pi 的 toolResult 消息（`ai/src/types.ts`）。 */
export function toolResultMessage(call: ToolCallRef, result: ToolResult): Message {
	return {
		role: "toolResult",
		content: result.content,
		toolCallId: call.id,
		toolName: call.name,
		isError: result.isError,
	};
}

/** 把助手消息里的工具调用块挑出来。pi 在 `agent-loop.ts:222` 做同一件事。 */
export function collectToolCalls(message: Message): readonly ToolCallRef[] {
	return message.content
		.filter((block): block is Extract<ContentBlock, { type: "toolCall" }> => block.type === "toolCall")
		.map((block) => ({ id: block.id, name: block.name, arguments: block.arguments }));
}

/**
 * 跑一次循环。
 *
 * 注意这个函数**是同步的**。pi 是异步的（`streamFunction` 返回一个异步迭代器），
 * 但对理解形状来说，同步版本少掉一层「流什么时候到」的干扰。
 * 事件顺序在两边是一样的。
 */
export function runLoop(options: RunLoopOptions): LoopResult {
	const emit: EventSink = options.emit ?? (() => {});
	const maxTurns = options.maxTurns ?? Number.POSITIVE_INFINITY;
	const prompts = options.prompts ?? [];

	// 上下文是不可变的：每一步都产出新的数组，而不是往老数组里 push。
	// pi 在这里用的是可变数组（`currentContext.messages.push(...)`，
	// `agent-loop.ts:205`）——那是为长会话的性能做的取舍，见 1.7 的规则表。
	let messages: readonly Message[] = [...options.context.messages, ...prompts];
	let turns = 0;
	const finish = (stopKind: StopKind): LoopResult => {
		emit({ type: "agent_end", messages });
		return { messages, stopKind, turns };
	};

	emit({ type: "agent_start" });
	emit({ type: "turn_start" });
	for (const prompt of prompts) announce(prompt, emit);

	// 外层循环：每转一圈是「一轮」。pi 的外层在 `agent-loop.ts:171`，内层在 175。
	while (true) {
		if (turns >= maxTurns) return finish("max_turns");
		if (turns > 0) emit({ type: "turn_start" });
		turns += 1;

		const reply = options.model({ ...options.context, messages });
		const assistant: Message = { role: "assistant", content: reply.content, stopReason: reply.stopReason };
		messages = [...messages, assistant];
		announce(assistant, emit);

		// 模型出错：不跑工具、不问宿主，直接结束（`agent-loop.ts:215-219`）。
		if (reply.stopReason === "error") {
			emit({ type: "turn_end", message: assistant, toolResults: [] });
			return finish("model_error");
		}

		const calls = collectToolCalls(assistant);
		// 截断不是退出路径：整批判失败，结果回给模型，让它重发（`agent-loop.ts:229-233`）。
		const batch =
			reply.stopReason === "length" ? failTruncatedBatch(calls, emit) : executeBatch(calls, options.tools, emit);
		messages = [...messages, ...batch.results];
		emit({ type: "turn_end", message: assistant, toolResults: batch.results });

		// 顺序照 pi：先问宿主，再看还有没有活（`agent-loop.ts:252` 在 269 之前）。
		if (options.shouldStopAfterTurn?.({ turn: turns, messages })) return finish("host_stopped");
		if (calls.length === 0) return finish("no_tool_calls");
		if (batch.terminate) return finish("tools_terminated");
	}
}

// ── 一轮里的几件事 ──────────────────────────────────────────────────────

interface Batch {
	readonly results: readonly Message[];
	/** 这一批是不是**全部**要求停。 */
	readonly terminate: boolean;
}

/**
 * 宣布一条进入上下文的消息。pi 的不变式是：**凡是这次运行里进上下文的消息，
 * 不管是用户、助手还是工具结果，都发一对 message_start / message_end**
 * （`agent/src/types.ts:436` 的注释原话，工具结果那一对在 `agent-loop.ts:791-794`）。
 * 有了这条，会话记录只需要订阅一个事件。
 */
function announce(message: Message, emit: EventSink): void {
	emit({ type: "message_start", message });
	emit({ type: "message_end", message });
}

/** 内层：把这一批工具跑完。空批次返回 terminate=false。 */
function executeBatch(calls: readonly ToolCallRef[], tools: readonly Tool[], emit: EventSink): Batch {
	const lookup: ToolLookup = (name) => tools.find((t) => t.spec.name === name);
	const results: Message[] = [];
	const verdicts: boolean[] = [];
	for (const call of calls) {
		emit({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name });
		const tool = lookup(call.name);
		// 未知工具不抛：变成一条失败结果，模型下一轮还能自己改。
		const result: ToolResult = tool ? tool.execute(call.arguments) : unknownTool(call.name);
		emit({ type: "tool_execution_end", toolCallId: call.id, toolName: call.name, isError: result.isError });
		const message = toolResultMessage(call, result);
		announce(message, emit);
		results.push(message);
		verdicts.push(result.terminate === true);
	}
	// pi 的规则：这一批非空，且**每一条**都要求停（`agent-loop.ts:580-582`）。
	return { results, terminate: verdicts.length > 0 && verdicts.every(Boolean) };
}

/** 截断的那一批：一条都不执行，每条都回一个「未执行」。对照 `agent-loop.ts:379-404`。 */
function failTruncatedBatch(calls: readonly ToolCallRef[], emit: EventSink): Batch {
	const results = calls.map((call) => {
		emit({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name });
		emit({ type: "tool_execution_end", toolCallId: call.id, toolName: call.name, isError: true });
		const message = toolResultMessage(call, {
			content: [
				{
					type: "text",
					text: `工具 ${call.name} 未执行：模型输出触到长度上限，参数可能不完整。请带着完整参数重新发起调用。`,
				},
			],
			details: "truncated",
			isError: true,
		});
		announce(message, emit);
		return message;
	});
	return { results, terminate: false };
}

function unknownTool(name: string): ToolResult {
	return { content: [{ type: "text", text: `没有名为 ${name} 的工具。` }], details: "unknown tool", isError: true };
}
