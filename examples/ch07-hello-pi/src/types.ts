/**
 * pi 的消息与上下文里我们用到的形状。字段名照 ai/src/types.ts。
 * 只抄必要的字段：真正的 Message 联合体在 ai/src/types.ts:467，
 * 上下文在 ai/src/types.ts:521。
 */

export interface TextBlock {
	readonly type: "text";
	readonly text: string;
}

export interface ToolCallBlock {
	readonly type: "toolCall";
	readonly id: string;
	readonly name: string;
	readonly arguments: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ToolCallBlock;

export interface UserMessage {
	readonly role: "user";
	readonly content: readonly ContentBlock[];
}

/** ai/src/types.ts:449 —— 工具结果是一条真正的消息，不是助手消息的一部分。 */
export interface ToolResultMessage {
	readonly role: "toolResult";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly content: readonly TextBlock[];
	readonly isError: boolean;
}

export interface AssistantMessage {
	readonly role: "assistant";
	readonly content: readonly ContentBlock[];
	/** "stop" | "toolUse" | "length" | "error" | "aborted" */
	readonly stopReason: string;
	readonly errorMessage?: string;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** 发给 provider 的工具描述。ai/src/types.ts 的 Tool 里这几项就是模型看到的部分。 */
export interface ProviderTool {
	readonly name: string;
	readonly description?: string;
}

/** ai/src/types.ts:521 */
export interface Context {
	readonly systemPrompt?: string;
	readonly messages: readonly Message[];
	readonly tools?: readonly ProviderTool[];
}

export function isToolResult(message: Message): message is ToolResultMessage {
	return message.role === "toolResult";
}

export function textOf(message: Message): string {
	return message.content
		.filter((block): block is TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}
