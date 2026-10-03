/**
 * 这一章要用的四种消息、两种内容块，字段名照 pi 的 `ai/src/types.ts` 抄。
 *
 * 抄字段名不是为了好看：全书所有 `file:line` 引用的都是这几个形状，
 * 你的实现里换了名字，后面每一章的对照都要在脑子里做一次翻译。
 */

export type Role = "user" | "assistant" | "toolResult";

export interface TextBlock {
	readonly type: "text";
	readonly text: string;
}

export interface ToolCallBlock {
	readonly type: "toolCall";
	readonly id: string;
	readonly name: string;
	readonly arguments: Readonly<Record<string, unknown>>;
}

export type ContentBlock = TextBlock | ToolCallBlock;

/** 模型停止生成的原因。只有 `toolUse` 会让循环继续。 */
export type StopReason = "stop" | "toolUse" | "length" | "error";

export interface Message {
	readonly role: Role;
	readonly content: readonly ContentBlock[];
	/** 助手消息才有。别的角色留空。 */
	readonly stopReason?: StopReason;
	/** toolResult 才有：它回应的是哪一次工具调用。 */
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly isError?: boolean;
}

/** 传给模型的东西。`systemPrompt` 不在 `messages` 里 —— 这是有意的，见 1.4。 */
export interface Context {
	readonly systemPrompt: string;
	readonly messages: readonly Message[];
	readonly tools: readonly ToolSpec[];
}

/** 模型看到的一份工具说明书。注意它和「工具怎么跑」是两回事。 */
export interface ToolSpec {
	readonly name: string;
	readonly description: string;
	/** 参数名 → 是否必填。真实实现用 typebox 之类的 schema，这里够用。 */
	readonly parameters: Readonly<Record<string, boolean>>;
}

/** 工具跑完的产物。`content` 回给模型，`details` 留给日志和 UI。 */
export interface ToolResult {
	readonly content: readonly ContentBlock[];
	readonly details: string;
	readonly isError: boolean;
	/**
	 * 这一批工具跑完之后就停。
	 * pi 的语义更严格：只有这一批里**每一条**都要求停，才真的停（`agent/src/types.ts:371-375`）。
	 */
	readonly terminate?: boolean;
}

export interface Tool {
	readonly spec: ToolSpec;
	execute(args: Readonly<Record<string, unknown>>): ToolResult;
}

export type ToolLookup = (name: string) => Tool | undefined;

// ── 事件：循环往外说的话 ────────────────────────────────────────────────

/**
 * 事件是循环唯一的对外接口。UI、日志、遥测全部订阅它，而不是去读循环的内部变量。
 * pi 的事件表在 `agent/src/types.ts:429-444`，这里只保留这一章要用的几种。
 */
export type AgentEvent =
	| { readonly type: "agent_start" }
	| { readonly type: "agent_end"; readonly messages: readonly Message[] }
	| { readonly type: "turn_start" }
	| { readonly type: "turn_end"; readonly message: Message; readonly toolResults: readonly Message[] }
	| { readonly type: "message_start"; readonly message: Message }
	| { readonly type: "message_end"; readonly message: Message }
	| { readonly type: "tool_execution_start"; readonly toolCallId: string; readonly toolName: string }
	| { readonly type: "tool_execution_end"; readonly toolCallId: string; readonly toolName: string; readonly isError: boolean };

export type EventSink = (event: AgentEvent) => void;
