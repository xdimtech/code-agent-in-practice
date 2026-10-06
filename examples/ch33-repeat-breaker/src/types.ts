/** 断路器用到的全部类型。状态和结果都是只读的：每一步返回新对象，不改旧的 */

/** 模型发出的一次工具调用。`args` 是已解析的参数；`arguments` 是模型给的原文（可能被截断） */
export interface ToolCall {
	readonly id: string;
	readonly tool: string;
	readonly args?: unknown;
	readonly arguments?: string;
}

/** 工具真正执行后的输出 */
export interface ToolOutput {
	readonly text: string;
	readonly isError: boolean;
}

/** 断路器加工后交还给模型的结果 */
export interface SettledResult extends ToolOutput {
	readonly id: string;
	/** 这次调用有没有真的执行：同一步里的重复和交接步里的调用都是 false */
	readonly executed: boolean;
}

export type Action = "none" | "r1" | "r2" | "r3" | "stop";

export type HandoffPhase = "idle" | "pending" | "active" | "done";

/** 遥测事件，作为数据交出去，不在断路器里发 */
export type BreakerEvent =
	| { readonly kind: "dedup"; readonly id: string; readonly tool: string; readonly dupType: "same_step" | "cross_step" }
	| { readonly kind: "turn_repeat"; readonly id: string; readonly tool: string; readonly count: number }
	| { readonly kind: "repeat"; readonly tool: string; readonly streak: number; readonly action: Action }
	| { readonly kind: "handoff"; readonly outcome: "vetoed" | "text" | "dropped" }
	| { readonly kind: "cycle"; readonly period: number; readonly repeats: number };
