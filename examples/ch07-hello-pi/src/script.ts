/**
 * 一个"脚本模型"：不联网，按上下文决定这一轮输出什么。
 *
 * 拆出来的原因是它能被单独测 —— 不需要 pi、不需要子进程、不需要异步。
 * 扩展里的 streamSimple 只是把这里的结果翻译成一串事件（src/stream.ts）。
 */
import { isToolResult, textOf, type Context, type Message } from "./types.ts";

export interface ToolCallPlan {
	readonly kind: "toolCall";
	readonly id: string;
	readonly name: string;
	readonly args: Record<string, unknown>;
}

export interface TextPlan {
	readonly kind: "text";
	readonly text: string;
}

export type Plan = ToolCallPlan | TextPlan;

export interface ScriptOptions {
	/** 第一轮要读的文件。默认 hello.txt。 */
	readonly file?: string;
	/** 第一轮调用的工具。默认 read。 */
	readonly tool?: string;
	/** 第二轮是不是把收到的上下文报出来。默认 true。 */
	readonly report?: boolean;
}

function lastMessage(context: Context): Message | undefined {
	return context.messages.length > 0 ? context.messages[context.messages.length - 1] : undefined;
}

function lineCount(text: string): number {
	return text === "" ? 0 : text.split("\n").length;
}

/**
 * 把 pi 发过来的上下文摊开成一段人读的报告。
 * 这是这个例子里最有用的部分：它让"宿主到底发了什么"变成看得见的文字。
 */
export function describeContext(context: Context, file: string): string {
	const lines = [`脚本模型收到第 ${context.messages.length} 条消息，回复如下：`];
	lines.push("");
	lines.push(`system prompt：${(context.systemPrompt ?? "").length} 个字符`);
	lines.push(`可用工具：${(context.tools ?? []).map((tool) => tool.name).join(", ") || "（没有）"}`);
	lines.push("");
	lines.push("消息：");
	for (const [index, message] of context.messages.entries()) {
		if (isToolResult(message)) {
			const body = textOf(message);
			const first = body.split("\n")[0] ?? "";
			lines.push(
				`  ${index}. ${message.role}（${message.toolName}${message.isError ? "，出错" : ""}）：${lineCount(body)} 行，第一行是 ${JSON.stringify(first)}`,
			);
			continue;
		}
		lines.push(`  ${index}. ${message.role}：${JSON.stringify(textOf(message).slice(0, 60))}`);
	}
	lines.push("");
	lines.push(`也就是说：${file} 的内容已经作为一条 toolResult 消息回到了上下文里。`);
	return lines.join("\n");
}

/**
 * 决定这一轮做什么。
 *
 * 规则只有一条：上下文里还没有 read 的结果，就调 read；有了，就用文字收尾。
 * 真实的模型在这里做的是同一件事的复杂版本 —— 差别只在"怎么决定"。
 */
export function planNextTurn(context: Context, options: ScriptOptions = {}): Plan {
	const file = options.file ?? "hello.txt";
	const tool = options.tool ?? "read";
	const report = options.report ?? true;

	const alreadyRead = context.messages.some((message) => isToolResult(message));
	if (!alreadyRead) {
		return { kind: "toolCall", id: "call_1", name: tool, args: { path: file } };
	}

	return {
		kind: "text",
		text: report ? describeContext(context, file) : `已读完 ${file}。`,
	};
}

/** 上一轮的停止原因。宿主用它决定继续循环还是收尾。 */
export function stopReasonFor(plan: Plan): string {
	return plan.kind === "toolCall" ? "toolUse" : "stop";
}
