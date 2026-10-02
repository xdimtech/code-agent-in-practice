// pi 会话文件里用得到的那一小部分类型。字段名与 pi 保持一致，方便对照源码：
// 头 core/session-manager.ts:32-39，条目基类 :46-51，条目联合 :144-153，
// 助手消息 packages/ai/src/types.ts:427-445，用量 :382-403，工具结果 :449-465，! 命令 core/messages.ts:29-40。

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
  readonly cacheWrite1h?: number;
  readonly totalTokens: number;
  readonly cost: Cost;
}

export interface TextPart { readonly type: "text"; readonly text: string }
export interface ThinkingPart { readonly type: "thinking"; readonly thinking: string }
export interface ImagePart { readonly type: "image"; readonly data: string; readonly mimeType: string }
export interface ToolCallPart {
  readonly type: "toolCall";
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type ContentPart = TextPart | ThinkingPart | ImagePart | ToolCallPart;

export interface UserMessage { readonly role: "user"; readonly content: string | readonly ContentPart[]; readonly timestamp: number }

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: readonly ContentPart[];
  readonly provider: string;
  readonly model: string;
  readonly responseModel?: string;
  readonly usage: Usage;
  readonly stopReason: string;
  readonly errorMessage?: string;
  readonly timestamp: number;
}

export interface ToolResultMessage {
  readonly role: "toolResult";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: readonly ContentPart[];
  readonly usage?: Usage;
  readonly isError: boolean;
  readonly timestamp: number;
}

export interface BashExecutionMessage {
  readonly role: "bashExecution";
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | undefined;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  readonly fullOutputPath?: string;
  /** !! 前缀：执行但不进上下文 */
  readonly excludeFromContext?: boolean;
  readonly timestamp: number;
}

/** 扩展自定义的消息角色在这里一律当作「其他」 */
export interface OtherMessage { readonly role: string; readonly [key: string]: unknown }

export type Message = UserMessage | AssistantMessage | ToolResultMessage | BashExecutionMessage | OtherMessage;

export interface SessionHeader {
  readonly type: "session";
  readonly version?: number;
  readonly id: string;
  readonly timestamp: string;
  readonly cwd: string;
  readonly parentSession?: string;
}

/** 每个条目都有 id / parentId：文件是一条条追加的流水，读出来是一棵树 */
export interface Entry {
  readonly type: string;
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: string;
  readonly message?: Message;
  readonly summary?: string;
  readonly firstKeptEntryId?: string;
  readonly tokensBefore?: number;
  readonly usage?: Usage;
  readonly provider?: string;
  readonly modelId?: string;
  readonly [key: string]: unknown;
}

export const isAssistant = (m: Message | undefined): m is AssistantMessage => m?.role === "assistant";
export const isToolResult = (m: Message | undefined): m is ToolResultMessage => m?.role === "toolResult";
export const isBashExecution = (m: Message | undefined): m is BashExecutionMessage => m?.role === "bashExecution";
export const isUser = (m: Message | undefined): m is UserMessage => m?.role === "user";
