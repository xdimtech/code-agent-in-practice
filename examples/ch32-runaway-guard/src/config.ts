/**
 * 配置：本地 + 远端两份，远端优先。
 *
 * 规则照抄 minimax-code：远端的值坏了，算「没覆盖」，不算「开」也不算「关」。
 * 阈值最小 3——2 次重复太常见（读一遍、改完再读一遍），提醒会变成噪音。
 */

import type { ToolKind } from "./types.ts";

export const MIN_THRESHOLD = 3;

export interface GuardConfig {
	readonly enabled: boolean;
	readonly threshold: number;
	/** 硬步数上限；undefined 表示不设（minimax-code 交互模式就是这样） */
	readonly maxSteps?: number;
	/** 只观测、不提醒 */
	readonly shadow: boolean;
	readonly tools: Readonly<Record<string, ToolKind>>;
}

export const DEFAULT_TOOLS: Readonly<Record<string, ToolKind>> = { task_output: "polling", task_query: "polling", todo_write: "exempt" };

export const DEFAULT_CONFIG: GuardConfig = { enabled: true, threshold: MIN_THRESHOLD, shadow: false, tools: DEFAULT_TOOLS };

export interface Override {
	readonly enabled?: boolean;
	readonly threshold?: number;
	readonly maxSteps?: number;
}

/** 形状不对的字段直接忽略：返回的是「这份配置明确说了什么」 */
export function parseOverride(raw: unknown): Override {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const r = raw as Record<string, unknown>;
	return {
		...(typeof r.enabled === "boolean" ? { enabled: r.enabled } : {}),
		...(isInt(r.threshold) && r.threshold >= MIN_THRESHOLD ? { threshold: r.threshold } : {}),
		...(isInt(r.maxSteps) && r.maxSteps > 0 ? { maxSteps: r.maxSteps } : {}),
	};
}

export function resolveConfig(local: unknown, remote?: unknown, base: GuardConfig = DEFAULT_CONFIG): GuardConfig {
	const l = parseOverride(local);
	const r = parseOverride(remote);
	const maxSteps = r.maxSteps ?? l.maxSteps ?? base.maxSteps;
	return {
		...base,
		enabled: r.enabled ?? l.enabled ?? base.enabled,
		threshold: r.threshold ?? l.threshold ?? base.threshold,
		...(maxSteps === undefined ? {} : { maxSteps }),
	};
}

function isInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}
