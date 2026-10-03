/**
 * 两个方案：基线一套工具，候选一套工具，差别只有「写文件」这一个动作。
 *
 * 这是本章最想让人记住的一条：比较实验的价值全在「只改一处」。
 * pi 的那个对照就是这么搭的——基线 `excludeGuidelinesAndDocumentation` 和候选
 * `prepareDefaultPromptOverride` 只差系统提示里截掉的那一段（`extensions.eval.ts:41-51`），
 * 别的地方一个字没动。差得越多，结论越像玄学。
 */

import { mkdirSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { Harness, Tool, ToolContext } from "./harness.ts";
import type { JsonValue } from "./types.ts";

/**
 * 解析路径，并说清它有没有跑出工作目录。
 *
 * 边界取 `context.cwd` 而不是 `context.root`，这一处很容易写错：`root` 是 harness 的临时目录，
 * cwd 是它的子目录 `root/work`。拿 root 当边界的话，脚本里的 `../build/output.txt` 会解析到
 * `root/build/output.txt`——看着像越界，其实还在沙箱里，于是「拦住越界」的那个方案根本不会拦。
 * 工作目录才是 agent 被交付的那块地方，出了它就是出了。
 *
 * root 存在的理由只有一个：让越界的那次写入仍然落在临时目录里，跑完能被删掉、能被观察到
 * （见 workspace.ts 为什么连 root 一起扫）。
 */
function resolveInside(context: ToolContext, path: string): { absolute: string; escaped: boolean } {
	const absolute = resolve(context.cwd, path);
	const inside = absolute === context.cwd || absolute.startsWith(`${context.cwd}/`);
	return { absolute, escaped: !inside };
}

/**
 * 文件系统错误只回错误码（ENOENT、EACCES……），不回 Node 的原始消息。
 * 原始消息里带绝对路径，而这个路径是每次运行都换的临时目录：进了轨迹就是噪声，
 * 进了产物还会把本机的目录结构带出去。错误码对模型和对读产物的人都够用了。
 */
function describeFsError(error: unknown): string {
	if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
	return error instanceof Error ? error.name : "未知错误";
}

function readArg(args: Record<string, JsonValue>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" ? value : undefined;
}

const readFile: Tool = {
	name: "read_file",
	run(args, context) {
		const path = readArg(args, "path");
		if (path === undefined) return { ok: false, error: "缺少 path 参数" };
		const { absolute, escaped } = resolveInside(context, path);
		if (escaped) return { ok: false, error: `${path} 不在工作目录里` };
		if (!existsSync(absolute)) return { ok: false, error: `${path} 不存在` };
		try {
			readFileSync(absolute, "utf8");
			return { ok: true };
		} catch (error) {
			return { ok: false, error: `${path} 读不了：${describeFsError(error)}` };
		}
	},
};

/**
 * 基线版写文件：目录不存在就失败，路径出不出得去不管。
 * 这是很多工具的第一版——`writeFileSync` 抛什么就回什么。
 */
const baselineWriteFile: Tool = {
	name: "write_file",
	run(args, context) {
		const path = readArg(args, "path");
		const content = readArg(args, "content");
		if (path === undefined) return { ok: false, error: "缺少 path 参数" };
		if (content === undefined) return { ok: false, error: "缺少 content 参数" };
		const absolute = resolve(context.cwd, path);
		try {
			writeFileSync(absolute, content, "utf8");
			return { ok: true };
		} catch (error) {
			return { ok: false, error: `${path} 写不了：${describeFsError(error)}` };
		}
	},
};

/**
 * 候选版写文件：差两处——先建父目录，写之前先看路径有没有出沙箱。
 *
 * 越界的判断放在写之前而不是写之后：写完了再报错，文件已经在磁盘上了，
 * 「拒绝」也就成了「事后通知」。这个顺序是本例第三个测试要盯的东西。
 */
const carefulWriteFile: Tool = {
	name: "write_file",
	run(args, context) {
		const path = readArg(args, "path");
		const content = readArg(args, "content");
		if (path === undefined) return { ok: false, error: "缺少 path 参数" };
		if (content === undefined) return { ok: false, error: "缺少 content 参数" };
		const { absolute, escaped } = resolveInside(context, path);
		if (escaped) {
			// 报错里给出的是「离工作目录有多远」，不是绝对路径：绝对路径进产物就是噪声
			const shown = isAbsolute(path) ? relative(context.cwd, absolute) : path;
			return { ok: false, error: `拒绝写入工作目录之外的 ${shown}` };
		}
		try {
			mkdirSync(dirname(absolute), { recursive: true });
			writeFileSync(absolute, content, "utf8");
			return { ok: true };
		} catch (error) {
			return { ok: false, error: `${path} 写不了：${describeFsError(error)}` };
		}
	},
};

/** 列目录，给假模型一个「先看看有什么」的动作，也让轨迹里不只有写 */
const listFiles: Tool = {
	name: "list_files",
	run(args, context) {
		const path = readArg(args, "path") ?? ".";
		const { absolute, escaped } = resolveInside(context, path);
		if (escaped) return { ok: false, error: `${path} 不在工作目录里` };
		if (!existsSync(absolute)) return { ok: false, error: `${path} 不存在` };
		try {
			if (!statSync(absolute).isDirectory()) return { ok: true };
			readdirSync(absolute);
			return { ok: true };
		} catch (error) {
			return { ok: false, error: `${path} 读不了：${describeFsError(error)}` };
		}
	},
};

export const BASELINE = "baseline-write";

/** 基线：一个直接调 writeFileSync 的写工具，外加读和列目录 */
export const baselineHarness: Harness = {
	name: BASELINE,
	tools: [readFile, listFiles, baselineWriteFile],
};

export const CANDIDATE = "careful-write";

/** 候选：只把写工具换成会建目录、会把路径关在沙箱里的那个 */
export const candidateHarness: Harness = {
	name: CANDIDATE,
	tools: [readFile, listFiles, carefulWriteFile],
};
