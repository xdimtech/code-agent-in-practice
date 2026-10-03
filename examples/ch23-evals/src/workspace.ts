/**
 * 现场拍照：脚本跑完、目录还没删的那一瞬间，把要判分的文件读数取走。
 *
 * 这一步必须和运行同步做。工作目录在 `runInWorkspace` 的 `finally` 里就删了，
 * 事后再去读只会拿到「文件不存在」——而那不是 agent 的错。
 * `inspect` 回调存在的全部理由就是这个时间窗。
 *
 * 路径一律用相对 cwd 的写法（`src/hello.ts`、`../build/output.txt`），
 * 越界的那些带 `../` 前缀，判分时一眼能认出来。绝对路径不进产物：
 * 每次运行的临时目录名都不一样，写进去等于把噪声当事实存下来。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { JsonValue } from "./types.ts";

export interface WorkspaceContext {
	readonly cwd: string;
	readonly root: string;
}

/** 最多走进几层。防的是有人误把 cwd 指到根目录上，跑出一个几万条的列表 */
const MAX_DEPTH = 6;

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walk(directory: string, depth: number, found: string[]): void {
	if (depth > MAX_DEPTH) return;
	let entries: string[];
	try {
		entries = readdirSync(directory);
	} catch {
		// 读不动就当空目录。权限、竞态都有可能，不值得让一次 eval 因此挂掉
		return;
	}
	for (const entry of entries.sort()) {
		if (SKIP_DIRS.has(entry)) continue;
		const absolute = resolve(directory, entry);
		let isDirectory = false;
		try {
			isDirectory = statSync(absolute).isDirectory();
		} catch {
			continue;
		}
		if (isDirectory) walk(absolute, depth + 1, found);
		else found.push(absolute);
	}
}

/**
 * 列出工作目录和沙箱里出现的所有文件，路径相对 cwd。
 *
 * 为什么连沙箱 root 一起扫：越界的写入落在 root 里（cwd 是 root/work），
 * 不扫 root 就看不见——「没看见」和「没发生」在这里必须分得开。
 * 越界文件会显示成 `../build/output.txt`，正是断言要抓的形状。
 */
export function listWorkspaceFiles(context: WorkspaceContext): string[] {
	const found: string[] = [];
	walk(context.root, 0, found);
	return found.map((absolute) => relative(context.cwd, absolute)).sort();
}

/** 读一个文件的内容；读不到就返回 undefined，让调用方自己决定算不算失败 */
export function readWorkspaceFile(context: WorkspaceContext): (path: string) => string | undefined {
	return (path: string) => {
		const absolute = resolve(context.cwd, path);
		if (absolute !== context.root && !absolute.startsWith(`${context.root}/`)) return undefined;
		try {
			if (!statSync(absolute).isFile()) return undefined;
			return readFileSync(absolute, "utf8");
		} catch {
			return undefined;
		}
	};
}

/** 把拍到的现场拼成 artifacts。键名固定，判分和产物两边都用这几个名字 */
export function snapshot(context: WorkspaceContext, extra: Record<string, JsonValue> = {}): Record<string, JsonValue> {
	return { files: listWorkspaceFiles(context), ...extra };
}
