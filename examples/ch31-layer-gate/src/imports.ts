/**
 * 从源码文本里抽出 import 说明符。
 *
 * Step-Code 的闸门用 TypeScript 编译器建 AST 来抽（scripts/check-layer-direction.mjs 的
 * extractSpecifiers）。本例要零依赖，所以分两步：先把注释和模板字符串的内容涂成空格（换行保留，
 * 行号不变），再用正则认四种写法。代价写在 README 的「本例的简化」里。
 */

import type { ImportRef } from "./types.ts";

type State = "code" | "line-comment" | "block-comment" | "single" | "double" | "template";

/** 把注释和模板字符串的内容换成空格。普通字符串保留——说明符就在里面。 */
export function blankNonCode(source: string): string {
	const out: string[] = [];
	let state: State = "code";
	for (let i = 0; i < source.length; i++) {
		const ch = source[i]!;
		const next = source[i + 1];
		const keep = (c: string) => out.push(c);
		const blank = (c: string) => out.push(c === "\n" ? "\n" : " ");
		switch (state) {
			case "code":
				if (ch === "/" && next === "/") {
					state = "line-comment";
					blank(ch);
				} else if (ch === "/" && next === "*") {
					state = "block-comment";
					blank(ch);
				} else {
					if (ch === "'") state = "single";
					else if (ch === '"') state = "double";
					else if (ch === "`") state = "template";
					keep(ch);
				}
				break;
			case "line-comment":
				if (ch === "\n") state = "code";
				blank(ch);
				break;
			case "block-comment":
				if (ch === "*" && next === "/") {
					blank(ch);
					blank(next);
					i++;
					state = "code";
				} else blank(ch);
				break;
			case "single":
			case "double": {
				// 普通字符串不能跨行：把正则字面量里的引号误认成字符串时，损害最多到行尾
				const quote = state === "single" ? "'" : '"';
				if (ch === "\\" && next !== undefined && next !== "\n") {
					keep(ch);
					keep(next);
					i++;
				} else {
					if (ch === quote || ch === "\n") state = "code";
					keep(ch);
				}
				break;
			}
			case "template":
				if (ch === "\\" && next !== undefined) {
					blank(ch);
					blank(next);
					i++;
				} else if (ch === "`") {
					state = "code";
					keep(ch);
				} else blank(ch);
				break;
		}
	}
	return out.join("");
}

// 前面不能是 . 或标识符字符：foo.import("x") 和 reimport 都不算
const LEAD = String.raw`(?<![.\w$])`;
const SPEC = String.raw`(["'])([^"'\n]+)\1`;
const PATTERNS: readonly RegExp[] = [
	// import x from "a" / import { a, b } from "a" / import type … / export * from "a" / export { a } from "a"
	new RegExp(String.raw`${LEAD}(?:import|export)\s+(?:type\s+)?(?:[\w$*\s,]|\{[^{}]*\})*?\bfrom\s*${SPEC}`, "g"),
	// import "a"（只为副作用）
	new RegExp(String.raw`${LEAD}import\s*${SPEC}`, "g"),
	// import("a") / require("a")
	new RegExp(String.raw`${LEAD}(?:import|require)\s*\(\s*${SPEC}\s*\)`, "g"),
];

function lineAt(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
	return line;
}

/** 按出现顺序返回全部说明符 */
export function extractImports(source: string): ImportRef[] {
	const text = blankNonCode(source);
	const found: { index: number; specifier: string }[] = [];
	for (const pattern of PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			found.push({ index: match.index, specifier: match[2]! });
		}
	}
	return found
		.toSorted((a, b) => a.index - b.index)
		.map(({ index, specifier }) => ({ specifier, line: lineAt(text, index) }));
}
