/**
 * 错误族：把一条错误结果归类，让「换了措辞的同一种失败」也能连起来。
 *
 * 顺序：结构化错误码 > 文本里的类别关键词 > 截断后的原文。
 * 另外认一种「预期失败」：单条 rg / grep 没找到东西时退出码是 1，那是答案，不是错误。
 */

import type { ToolCall, ToolResult } from "./types.ts";

const CATEGORIES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
	{ name: "timeout", pattern: /timeout|timed out|deadline exceeded/ },
	{ name: "rate_limit", pattern: /rate.?limit|too many requests|\b429\b/ },
	{ name: "network", pattern: /network|econn|socket|dns|connection reset/ },
	{ name: "auth", pattern: /unauth|invalid api key|\b401\b/ },
	{ name: "permission", pattern: /permission|forbidden|access denied|\b403\b/ },
	{ name: "not_found", pattern: /not found|enoent|\b404\b/ },
	{ name: "invalid_argument", pattern: /invalid argument|validation failed|bad request|\b400\b/ },
	{ name: "process_exit", pattern: /exit code|non-zero|process failed/ },
];

const MAX_TEXT_CHARS = 1024;
const SHELL_TOOLS = new Set(["bash", "sh", "shell", "zsh"]);

export function errorFamily(tool: string, result: ToolResult): string | undefined {
	if (result.code) return `${tool}\u0000code:${result.code}`;
	const normalized = result.text.toLowerCase();
	const category = CATEGORIES.find(({ pattern }) => pattern.test(normalized))?.name;
	if (category) return `${tool}\u0000category:${category}`;
	const bounded = normalized.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
	return bounded ? `${tool}\u0000text:${bounded}` : undefined;
}

/** 单条搜索命令「没找到」：复合命令一律不算，宁可多报 */
export function isExpectedNoMatch(call: ToolCall, result: ToolResult): boolean {
	if (!result.isError || !SHELL_TOOLS.has(call.tool)) return false;
	const command = commandOf(call.args);
	if (!command || !/^(?:rg|grep|git\s+grep)(?:\s|$)/u.test(command.trim())) return false;
	if (/[;&|`$<>\\\r\n]/u.test(command)) return false;
	return result.text.trim().toLowerCase() === "command exited with code 1";
}

function commandOf(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const command = (args as Record<string, unknown>)["command"];
	return typeof command === "string" ? command : undefined;
}
