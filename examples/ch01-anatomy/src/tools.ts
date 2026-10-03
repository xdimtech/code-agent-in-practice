/**
 * 第 1 章的工具：两个只读工具 + 一个写工具。
 *
 * 这些工具本身不重要——它们是第 10 章的主角。放在这里是因为循环需要
 * 「有东西可跑」才能把形状跑出来。三个工具刻意分成两类（只读 / 写），
 * 后面 1.6 节要看这两个分类各自意味着什么。
 *
 * 全部零依赖：只用 node:fs 和 node:path。
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { Tool, ToolResult } from "./types.ts";

/** 把任意的入参收成一个字符串，缺字段时给默认值。真实实现用 schema 校验（第 10 章）。 */
function asString(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" ? value : undefined;
}

function text(body: string, details: string): ToolResult {
	return { content: [{ type: "text", text: body }], details, isError: false };
}

function failure(body: string, details: string): ToolResult {
	return { content: [{ type: "text", text: body }], details, isError: true };
}

/**
 * 工具失败的两种写法，这一章只区分一种：
 * **可预期的失败**（文件不存在、参数不对）返回 `isError: true` 的结果，让模型看到并自己纠正；
 * **不可预期的失败**（磁盘坏了）才抛异常。
 *
 * 这条分界是这一章最实用的一条规则——见 1.6。把可预期的失败写成异常，
 * 循环会终止，模型连「换个路径再试一次」的机会都没有。
 */

// ── read_file ───────────────────────────────────────────────────────────

const MAX_LINES = 200;

export function createReadFileTool(): Tool {
	return {
		spec: {
			name: "read_file",
			description: `读一个文本文件，最多返回 ${MAX_LINES} 行。参数 path 是相对路径。`,
			parameters: { path: true },
		},
		execute(args) {
			const path = asString(args, "path");
			if (!path) return failure("缺少参数 path。", "missing-arg");

			let raw: string;
			try {
				raw = readFileSync(path, "utf8");
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "ENOENT") return failure(`文件不存在：${path}`, "enoent");
				if (code === "EISDIR") return failure(`这是一个目录，不是文件：${path}`, "eisdir");
				// 其它错误才是真的异常情况，交给调用方决定。
				throw error;
			}

			const lines = raw.split("\n");
			if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
			const shown = lines.slice(0, MAX_LINES);
			const truncated = lines.length > MAX_LINES;
			const body = shown.join("\n") + (truncated ? `\n…（还有 ${lines.length - MAX_LINES} 行）` : "");

			return text(body, `${shown.length} 行${truncated ? "（截断）" : ""}`);
		},
	};
}

// ── list_dir ────────────────────────────────────────────────────────────

import { readdirSync } from "node:fs";

export function createListDirTool(): Tool {
	return {
		spec: {
			name: "list_dir",
			description: "列出一个目录下的条目。名字以 / 结尾的是目录。",
			parameters: { path: false },
		},
		execute(args) {
			const path = asString(args, "path") ?? ".";
			let entries: string[];
			try {
				entries = readdirSync(path).sort();
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "ENOENT") return failure(`目录不存在：${path}`, "enoent");
				if (code === "ENOTDIR") return failure(`这不是目录：${path}`, "enotdir");
				throw error;
			}
			const named = entries.map((name) => {
				try {
					return statSync(resolve(path, name)).isDirectory() ? `${name}/` : name;
				} catch {
					// 读不了单个条目的类型不影响列出它——断链符号链接就会走到这里。
					return name;
				}
			});
			return text(named.join("\n") || "（空目录）", `${named.length} 个条目`);
		},
	};
}

// ── write_file ──────────────────────────────────────────────────────────

export function createWriteFileTool(): Tool {
	return {
		spec: {
			name: "write_file",
			description: "把内容写入一个文件，覆盖原有内容。参数 path 与 content 都必填。",
			parameters: { path: true, content: true },
		},
		execute(args) {
			const path = asString(args, "path");
			const content = asString(args, "content");
			if (!path) return failure("缺少参数 path。", "missing-arg");
			if (content === undefined) return failure("缺少参数 content。", "missing-arg");
			try {
				writeFileSync(path, content, "utf8");
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "ENOENT") return failure(`目标目录不存在：${path}`, "enoent");
				if (code === "EACCES") return failure(`没有写权限：${path}`, "eacces");
				throw error;
			}
			const bytes = Buffer.byteLength(content, "utf8");
			return text(`已写入 ${path}（${bytes} 字节）`, `${bytes} 字节`);
		},
	};
}

/**
 * 哪些工具会改动磁盘。这一章只用它做一件事：把分类打出来。
 * 第 15 章会把它变成真正的策略闸门——只读工具直接跑，写工具先过闸门。
 */
export function isMutating(tool: Tool): boolean {
	return tool.spec.name === "write_file";
}

/**
 * 判断一个路径是否在给定的根目录之内。第 15 章的策略层会用同一招。
 *
 * 判的是 `relative()` 算出来的**第一段**是不是 `..`，而不是「字符串里有没有 `..`」。
 * 后者会把 `..foo`、`a..b/c` 这种合法文件名误杀；`resolve()` 已经把中间的
 * `x/../` 折叠掉了，能剩下来的 `..` 只可能出现在开头。
 */
export function isInsideRoot(root: string, target: string): boolean {
	const normalizedRoot = resolve(root);
	const normalizedTarget = resolve(root, target);
	const rel = relative(normalizedRoot, normalizedTarget);
	if (rel === "") return true;
	if (isAbsolute(rel)) return false;
	return rel.split(sep)[0] !== "..";
}
