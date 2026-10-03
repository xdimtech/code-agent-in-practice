/**
 * 一个脚本模型：按剧本回消息，不看上下文。
 *
 * 为什么这一章需要一个假模型：真模型有两个属性会挡住观察——
 * 它不确定（同样输入不一定同样输出），而且它要花钱和联网。
 * 要看清楚循环的形状，需要一个「同样输入必然同样输出」的模型。
 * 这不是作弊：pi 的上游测试也是这么做的，被替换的只是 `streamFunction`
 * 这一个参数（`agent-loop.ts:162`），循环本身一行都不用改。
 *
 * 这也正是 1.3 那条分界的第一个证据：**模型是可替换的**。
 * 一个设计如果做不到这点，它把模型焊死在循环里了。
 */

import type { AssistantReply, ModelFn } from "./loop.ts";
import type { ContentBlock, Context, Message } from "./types.ts";

/** 剧本里的一步：要么说一句话，要么调一个工具。 */
export type Step =
	| { readonly kind: "say"; readonly text: string }
	| {
			readonly kind: "call";
			readonly name: string;
			readonly args: Readonly<Record<string, unknown>>;
			/** 可选：调完工具后顺带说一句。 */
			readonly text?: string;
			/** 制造一次「被截断」的响应。 */
			readonly truncated?: boolean;
		};

/** 把剧本变成模型函数。每一步消耗一次调用，剧本用完就返回一句话收尾。 */
export function scriptedModel(steps: readonly Step[]): ModelFn {
	let cursor = 0;
	return (_context: Context): AssistantReply => {
		const step = steps[cursor];
		cursor += 1;
		if (!step) {
			return { content: [{ type: "text", text: "（剧本已经走完）" }], stopReason: "stop" };
		}
		if (step.kind === "say") {
			return { content: [{ type: "text", text: step.text }], stopReason: "stop" };
		}
		const content: ContentBlock[] = [];
		if (step.text) content.push({ type: "text", text: step.text });
		content.push({
			type: "toolCall",
			// id 只要在这一次响应里唯一就行——工具结果靠它配对。
			id: `call_${cursor}`,
			name: step.name,
			arguments: step.args,
		});
		return { content, stopReason: step.truncated ? "length" : "toolUse" };
	};
}

/** 几步之后回一条错误。用来观察「模型出错」这条退出路径。 */
export function failingModel(afterTurns: number): ModelFn {
	let seen = 0;
	return () => {
		seen += 1;
		if (seen > afterTurns) {
			return { content: [{ type: "text", text: "上游 500" }], stopReason: "error" };
		}
		return {
			content: [
				{ type: "text", text: "先看一眼目录。" },
				{ type: "toolCall", id: `call_${seen}`, name: "list_dir", arguments: { path: "." } },
			],
			stopReason: "toolUse",
		};
	};
}

/** 上下文里最后一条消息的纯文本，给调试用。 */
export function lastText(messages: readonly Message[]): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message) continue;
		const text = message.content
			.filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
			.map((block) => block.text)
			.join("\n");
		if (text) return text;
	}
	return "";
}
