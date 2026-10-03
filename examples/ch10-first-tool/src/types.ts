// 本例的全部词汇。形状照 pi 的工具定义（core/extensions/types.ts:451-500）和工具结果（agent/src/types.ts:361-384），
// 只留本例用得到的字段；渲染、constrainedSampling、usage 都没有。

/** JSON Schema 的一个子集：够描述工具参数，不支持 anyOf / oneOf / $ref */
export interface Schema {
  readonly type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: Schema;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface TextContent {
  readonly type: "text";
  readonly text: string;
}

/** 工具返回的东西。注意没有 isError：pi 只认抛错（agent/src/agent-loop.ts:698-705） */
export interface ToolResult {
  readonly content: readonly TextContent[];
  readonly details: unknown;
  readonly terminate?: boolean;
}

export type OnUpdate = (partial: ToolResult) => void;

export interface ToolContext {
  readonly cwd: string;
}

export type ExecutionMode = "parallel" | "sequential";

export interface ToolDef {
  readonly name: string;
  readonly label: string;
  /** 给模型看：写清楚做什么、截断上限、出错时怎么办 */
  readonly description: string;
  /** 一行，进系统提示词的 Available tools；不给就不列（core/system-prompt.ts:80-84） */
  readonly promptSnippet?: string;
  /** 工具激活时追加到 Guidelines；每条要写出工具名 */
  readonly promptGuidelines?: readonly string[];
  readonly parameters: Schema;
  /** 校验前的兼容垫片：把旧参数形状改成新的，公开 schema 保持严格 */
  readonly prepareArguments?: (args: unknown) => unknown;
  /** 不写就是批次默认（pi 是 parallel） */
  readonly executionMode?: ExecutionMode;
  execute(id: string, params: never, signal: AbortSignal | undefined, onUpdate: OnUpdate | undefined, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

/** 回到模型的那条消息（agent/src/agent-loop.ts:775-789） */
export interface ToolResultMessage {
  readonly role: "toolResult";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: readonly TextContent[];
  readonly details: unknown;
  readonly isError: boolean;
}

/** 用法或输入有问题：退出码 2 */
export class InputError extends Error {}

export const text = (t: string): readonly TextContent[] => [{ type: "text", text: t }];
