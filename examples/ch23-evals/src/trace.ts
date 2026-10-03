/**
 * 轨迹归一化：把一次运行里必然不同、但不代表行为变了的字段拿掉。
 *
 * 不归一化的话，两次运行永远不一样——临时目录带随机后缀，工具调用 id 每次新生成，
 * 耗时每毫秒都在变。回归对比就变成了「比噪音」，看不出真正想比的东西。
 *
 * 但归一化本身是个陷阱：抹得太多，把该发现的差异也抹掉了。所以这里的默认值只覆盖
 * 三条明确无害的规则，其余要显式传进来；并且只递归普通对象和数组，遇到 Date、Map
 * 这类对象直接不碰。
 */

import { stripRoot } from "./root.ts";
import type { AgentEvent, JsonValue } from "./types.ts";

export interface NormalizeOptions {
	/** 值一律换成占位符的字段名（小写比较） */
	readonly volatileKeys?: readonly string[];
	/** 轨迹里出现的这个路径前缀换成 `<root>` */
	readonly root?: string;
	/** 单个字符串超过这么多字符就截断，默认 400；0 表示不截 */
	readonly maxStringLength?: number;
}

/** 默认配置：只做三件确定无害的事，其余留给调用方显式打开 */
export const TRACE_OPTIONS: NormalizeOptions = {
	volatileKeys: ["id", "toolcallid", "timestamp", "startedat", "endedat", "durationms", "elapsedms", "runid", "sessionid"],
	root: "",
	maxStringLength: 400,
};

/** 默认要抹掉的字段：都是「这次运行自己的编号/时刻」，不影响行为判断 */
export const DEFAULT_VOLATILE_KEYS: readonly string[] = TRACE_OPTIONS.volatileKeys ?? [];

/** 被抹掉的值换成这个，而不是消失——字段在不在本身也是信息 */
export const VOLATILE_PLACEHOLDER = "<volatile>";

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (value === null || typeof value !== "object") return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

function truncate(text: string, max: number): string {
	if (max <= 0 || text.length <= max) return text;
	return `${text.slice(0, max)}…[+${text.length - max}]`;
}

function rewritePath(text: string, root: string | undefined): string {
	if (!root) return text;
	// 两种写法都要认：正斜杠的 posix 路径，和 Windows 上的反斜杠
	let out = stripRoot(text, root);
	const windows = root.split("/").join("\\");
	if (windows !== root) out = stripRoot(out, windows);
	return out;
}

/**
 * 键名的比较口径：不分大小写，也不认 `_` `-` `.` 这几个分隔符。
 * 同一个字段在不同提供方那里会叫 sessionId、session_id、SESSION-ID——
 * 只认其中一种写法，另外两种就会漏进快照，每跑一次 diff 一次。
 */
function canonicalKey(key: string): string {
	return key.toLowerCase().replace(/[_.-]/g, "");
}

/**
 * 归一一个值。键名命中 volatileKeys 就整枝换成占位符。
 *
 * 入参是 unknown 而不是 JsonValue：要归一的东西来自提供方和工具，类型上说是 JSON，
 * 实际上什么都可能塞进来（Date、Map、undefined）。在边界上收 unknown、吐 JsonValue，
 * 比假装上游守规矩要稳。
 */
export function normalizeValue(value: unknown, options: NormalizeOptions = {}): JsonValue {
	const volatile = new Set((options.volatileKeys ?? DEFAULT_VOLATILE_KEYS).map(canonicalKey));
	const max = options.maxStringLength ?? 400;

	const walk = (current: unknown, key: string | undefined): JsonValue => {
		if (key !== undefined && volatile.has(canonicalKey(key))) return VOLATILE_PLACEHOLDER;
		if (current === null || typeof current === "boolean" || typeof current === "number") {
			if (typeof current === "number" && !Number.isFinite(current)) return "<nonfinite>";
			return current;
		}
		if (typeof current === "string") return truncate(rewritePath(current, options.root), max);
		if (Array.isArray(current)) return current.map((item) => walk(item, undefined));
		if (isPlainObject(current)) {
			const entries = Object.entries(current)
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([name, item]): [string, JsonValue] => [name, walk(item, name)]);
			return Object.fromEntries(entries);
		}
		// 不是普通对象也不认识的（Date、Map、函数、undefined…）：不猜，标出来
		const typeName = typeof current === "object" || typeof current === "function" ? current?.constructor?.name : undefined;
		return `<${typeName ?? typeof current}>`;
	};

	return walk(value, undefined);
}

export function normalizeEvents(events: readonly AgentEvent[], options: NormalizeOptions = {}): JsonValue[] {
	return events.map((event) => normalizeValue(event, options));
}

/** 只留每个事件的类型和工具名，用来看「有没有多调/少调」而不受参数内容干扰 */
export function eventShape(events: readonly AgentEvent[]): string[] {
	return events.map((event) =>
		event.type === "tool_call" || event.type === "tool_result" ? `${event.type}:${event.name}` : event.type,
	);
}
