/**
 * 调用的键：工具名 + 规范化的参数。
 *
 * 规范化就是对象键排序后的 JSON，所以 {a,b} 和 {b,a} 是同一个键。
 * 参数原文解析失败时，键用原文本身——和 kimi-code 一样。如果退回成 `{}`，
 * 两次被截断在不同位置的调用会撞成同一个键，断路器就会冤枉它们。
 */

import type { ToolCall } from "./types.ts";

export interface ParsedArgs {
	readonly args: unknown;
	readonly parseFailed: boolean;
}

export function canonical(value: unknown): string {
	return JSON.stringify(sortValue(value)) ?? String(value);
}

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortValue);
	if (value === null || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(Object.keys(record).toSorted().map((k) => [k, sortValue(record[k])]));
}

/** 优先用已解析的 `args`；否则解析原文。空原文当作 `{}`，不算失败 */
export function parseArguments(call: ToolCall): ParsedArgs {
	if (call.args !== undefined) return { args: call.args, parseFailed: false };
	const raw = call.arguments;
	if (raw === undefined || raw.length === 0) return { args: {}, parseFailed: false };
	try {
		return { args: JSON.parse(raw) as unknown, parseFailed: false };
	} catch {
		return { args: {}, parseFailed: true };
	}
}

export function callKey(call: ToolCall): string {
	const parsed = parseArguments(call);
	return `${call.tool} ${parsed.parseFailed ? canonical(call.arguments) : canonical(parsed.args)}`;
}
