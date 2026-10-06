/**
 * 共用类型。
 *
 * 防跑飞只回答一个问题：「这一轮是不是在原地打转？要不要提醒模型一次？」
 *
 *   指纹（fingerprint.ts）参数和结果只留 HMAC，不留原文；密钥每轮新生成
 *   错误（errors.ts）     把一条错误结果归到一个「错误族」，认出「搜索没找到」这种预期失败
 *   检测（detector.ts）   每一步更新五组连击，纯函数，返回新状态
 *   守卫（guard.ts）      选一条提醒、一轮最多一次、先占位再 steer、失败放行
 *   回放（replay.ts）     读 JSONL 轨迹，逐步喂给守卫，从不真的 steer
 *
 * 判定是「提醒」不是「拦截」：守卫从不拒绝工具调用；唯一会停的是可选的硬步数上限。
 */

/** detect：参与全部检测；polling：只看「同一个查询得到同一个回答」；exempt：不看 */
export type ToolKind = "detect" | "polling" | "exempt";

export interface ToolCall {
	readonly id: string;
	readonly tool: string;
	readonly args: unknown;
}

export interface ToolResult {
	/** 对应 ToolCall.id */
	readonly id: string;
	readonly isError: boolean;
	readonly text: string;
	/** 工具给的结构化错误码；有它就不看文本 */
	readonly code?: string;
}

/** 宿主核实过的进度：同一个目标的 state 一直不变，就是「没进展」 */
export interface Progress {
	readonly target: string;
	readonly state: string;
}

/** 一步 = 一条助手消息里的全部 tool call，加上它们的结果 */
export interface Step {
	readonly calls: readonly ToolCall[];
	readonly results: readonly ToolResult[];
	readonly progress?: readonly Progress[];
}

export type SignalKind =
	| "action_repeat" // 参数完全相同的调用连续出现
	| "polling_repeat" // 轮询类工具：同一个查询连续得到同一个回答
	| "result_repeat" // 结果完全相同（只观测）
	| "error_family" // 同一个动作连续落进同一个错误族
	| "no_progress" // 宿主报告的进度对同一个目标没变
	| "abab"; // 两批动作交替（只观测）

/** 能触发提醒的四种；数组顺序就是优先级 */
export const REMINDABLE = ["no_progress", "error_family", "action_repeat", "polling_repeat"] as const;
export type RemindableKind = (typeof REMINDABLE)[number];

export interface Observation {
	readonly step: number;
	readonly signal: SignalKind;
	readonly occurrences: number;
}

export type Decision =
	| { readonly kind: "continue" }
	| { readonly kind: "remind"; readonly signal: RemindableKind; readonly content: string }
	| { readonly kind: "stop"; readonly reason: string };
