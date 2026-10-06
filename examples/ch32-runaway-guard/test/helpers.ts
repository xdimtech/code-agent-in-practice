/** 测试共用的小工具：造步、造密钥 */

import type { Step } from "../src/types.ts";

export const SECRET = Buffer.alloc(32, 7);

let next = 0;

/** 一步、一个调用、一个结果 */
export function step(tool: string, args: unknown, text = "ok", options: { isError?: boolean; code?: string } = {}): Step {
	const id = `t${++next}`;
	return {
		calls: [{ id, tool, args }],
		results: [{ id, isError: options.isError ?? false, text, ...(options.code ? { code: options.code } : {}) }],
	};
}

export function repeat(count: number, make: (i: number) => Step): readonly Step[] {
	return Array.from({ length: count }, (_, i) => make(i));
}
