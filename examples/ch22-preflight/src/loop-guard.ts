/**
 * 必补第一件：刹车。
 *
 * pi 的循环留了宿主刹车 `shouldStopAfterTurn`（agent/src/agent-loop.ts:252），
 * 但 coding-agent 的源码里没有一处设置它。扩展拿不到这个参数，能用的是两样：
 *
 *   1. tool_call 返回 { block, reason, terminate: true }（core/extensions/types.ts:1125-1134）。
 *      被拦的调用变成一条带 terminate 的失败结果（agent-loop.ts:633-643）；
 *      这一批每一条都这么拦时，循环从「工具要求停」那扇门出去（:581、:235）。
 *   2. turn_end 时数轮数，到上限就 ctx.abort()（types.ts:338）。
 *
 * 状态不可变：每个函数返回新状态，调用方自己换引用。
 */

import { createHash } from "node:crypto";

export interface GuardLimits {
	/** 一次运行最多跑几轮（一轮 = 一次模型回答 + 它引发的工具） */
	readonly maxTurns: number;
	/** 同一个调用（同一工具 + 同一组参数 + 同一代工作区）最多允许几次 */
	readonly maxRepeats: number;
}

export const DEFAULT_LIMITS: GuardLimits = { maxTurns: 40, maxRepeats: 3 };

/**
 * 会改工作区的工具。调用一次就算工作区换了「一代」，
 * 之后同样的 `npm test` 算新调用——改完代码再跑一遍测试是正常的，不该被当成打转。
 *
 * 代价有两头：用 bash 改文件（`sed -i`、`git apply`）不会换代，这种改法下重复跑测试仍会被数进去；
 * 反过来，一次失败的 edit 也算换代（判断发生在执行之前，还不知道成没成）。
 */
export const MUTATING_TOOLS: readonly string[] = ["edit", "write"];

export interface GuardState {
	readonly turns: number;
	readonly generation: number;
	readonly counts: Readonly<Record<string, number>>;
}

export type Verdict =
	| { readonly kind: "allow"; readonly count: number }
	| { readonly kind: "block"; readonly count: number; readonly reason: string; readonly terminate: true };

export const initialState = (): GuardState => ({ turns: 0, generation: 0, counts: {} });

/** 配置来自用户文件，按外部输入对待：不是正整数就拒绝，不悄悄换成默认值。 */
export function validateLimits(input: unknown): GuardLimits {
	if (typeof input !== "object" || input === null) throw new TypeError("limits 必须是对象");
	const record = input as Record<string, unknown>;
	const pick = (name: keyof GuardLimits): number => {
		const value = record[name] ?? DEFAULT_LIMITS[name];
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
			throw new TypeError(`${name} 必须是 ≥ 1 的整数，收到 ${JSON.stringify(value)}`);
		}
		return value;
	};
	return { maxTurns: pick("maxTurns"), maxRepeats: pick("maxRepeats") };
}

/** 键排好序再序列化：模型两次给的参数顺序不同，指纹也要一样。 */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** 参数可能是一整个文件的内容，存哈希不存原文。 */
export function fingerprint(toolName: string, input: unknown, generation: number): string {
	const digest = createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, 16);
	return `${toolName}@${generation}:${digest}`;
}

export function onToolCall(
	state: GuardState,
	limits: GuardLimits,
	toolName: string,
	input: unknown,
): { readonly state: GuardState; readonly verdict: Verdict } {
	const key = fingerprint(toolName, input, state.generation);
	const count = (state.counts[key] ?? 0) + 1;
	const generation = MUTATING_TOOLS.includes(toolName) ? state.generation + 1 : state.generation;
	const next: GuardState = { ...state, generation, counts: { ...state.counts, [key]: count } };
	if (count <= limits.maxRepeats) return { state: next, verdict: { kind: "allow", count } };
	return {
		state: next,
		verdict: {
			kind: "block",
			count,
			reason: `同一个 ${toolName} 调用这是第 ${count} 次（上限 ${limits.maxRepeats}），工作区在这期间没有变化。停下来，换个思路或者问用户。`,
			terminate: true,
		},
	};
}

export function onTurnEnd(
	state: GuardState,
	limits: GuardLimits,
): { readonly state: GuardState; readonly stop: boolean; readonly reason?: string } {
	const turns = state.turns + 1;
	const next: GuardState = { ...state, turns };
	if (turns < limits.maxTurns) return { state: next, stop: false };
	return { state: next, stop: true, reason: `已经跑了 ${turns} 轮（上限 ${limits.maxTurns}）` };
}
