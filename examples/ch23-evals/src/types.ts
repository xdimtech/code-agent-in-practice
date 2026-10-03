/**
 * 一次运行的全部形状。零依赖，全是纯数据。
 *
 * 一次运行 = 一串事件 + 结束时的一组统计。事件分五种，够描述一个 agent 做了什么：
 * prompt（用户说了什么）、tool_call（模型要调什么）、tool_result（结果是什么）、
 * response（最后回什么）、error（哪一步炸了）。thinking 只是文本的一种，不单列。
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 一次工具调用的结果，只留判断要用到的部分 */
export interface ToolResult {
	readonly ok: boolean;
	/** 失败原因；成功时没有 */
	readonly error?: string;
}

export type AgentEvent =
	| { readonly type: "prompt"; readonly content: string }
	| { readonly type: "tool_call"; readonly name: string; readonly args: Record<string, JsonValue> }
	| { readonly type: "tool_result"; readonly name: string; readonly result: ToolResult }
	| { readonly type: "response"; readonly content: string }
	| { readonly type: "error"; readonly message: string };

/** 一次运行的统计。缺席的字段就是「这次没测到」，不是 0 */
export interface RunUsage {
	readonly provider: string;
	readonly model: string;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly totalTokens?: number;
	readonly toolCalls?: number;
	readonly totalMs?: number;
	readonly estimatedCostUsd?: number;
}

export interface RunResult {
	/** 最后一条 response 的正文 */
	readonly output: string;
	readonly events: readonly AgentEvent[];
	readonly usage: RunUsage;
	/** 这次运行自己的产物（原始轨迹、落盘文件等），由 harness 决定放什么 */
	readonly artifacts: Readonly<Record<string, JsonValue>>;
}

/** 一次运行的判定结果。score 用 0..1，约定 >= 1 算通过（和下游的 summary 一致） */
export interface Verdict {
	readonly score: number;
	/** 没通过就说清哪一条没过；通过时给一句概括 */
	readonly rationale: string;
}

export type Judge = (result: RunResult) => Verdict;

/**
 * 一条观测：某次重复里、某个方案、在某次输入上得了多少分。
 * 对比是成对做的，所以组内用 groupKey + repetition 认人（见 score.ts）。
 */
export interface Observation {
	/** 哪个 eval 集，比如 "扩展作者体验" */
	readonly evalSet: string;
	/** 同一次输入的同一次重复的组内标识 */
	readonly groupKey: string;
	/** 第几次重复，从 1 数起 */
	readonly repetition: number;
	/** 哪个方案（基线也要有自己的名字） */
	readonly harness: string;
	/** 判分结果；缺席就是没测到 */
	readonly score?: number;
	/** 这次运行崩了，没有分数可谈 */
	readonly errored?: boolean;
	readonly totalTokens?: number;
	readonly totalMs?: number;
	readonly estimatedCostUsd?: number;
}
