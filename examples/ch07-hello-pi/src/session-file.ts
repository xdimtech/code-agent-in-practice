/**
 * 会话目录与会话文件：跑完一次之后，磁盘上留下了什么。
 *
 * 目录名的规则在 core/session-manager.ts:476-481：
 *
 *     join(agentDir, "sessions", `--${cwd 去掉开头的斜杠、再把斜杠和冒号换成横杠}--`)
 *
 * 每个工作目录一个子目录，里面的文件是一次会话。这一点值得记住：
 * 换一个目录跑，就是另一份历史；同名不同目录不会混在一起。
 *
 * 这个模块只读不写。它要能回答三个问题：目录叫什么、里面有几个会话、
 * 最近一次会话有多少条记录。
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * pi 用的是解析过符号链接之后的路径（core/session-manager.ts:474 收的是
 * `resolvedCwd`）。macOS 上 `/tmp` 是 `/private/tmp` 的符号链接，
 * 不解析的话目录名会差一段，看着像"会话丢了"。
 */
export function resolveCwd(cwd: string): string {
	try {
		return realpathSync(resolve(cwd));
	} catch {
		// 目录不存在也可能要列（先建过再删）：退回未解析的绝对路径。
		return resolve(cwd);
	}
}

/**
 * core/session-manager.ts:476-479 的路径规则，照抄。
 * `resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")`
 */
export function sessionDirName(cwd: string): string {
	const flattened = cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
	return `--${flattened}--`;
}

/** core/session-manager.ts:474 —— `join(agentDir, "sessions", dirName)`。 */
export function sessionDirPath(agentDir: string, cwd: string): string {
	return join(agentDir, "sessions", sessionDirName(cwd));
}

export interface SessionFile {
	readonly name: string;
	readonly path: string;
	readonly bytes: number;
	readonly lines: number;
}

export interface SessionSummary {
	readonly agentDir: string;
	readonly cwd: string;
	readonly dir: string;
	readonly dirExists: boolean;
	readonly sessions: readonly SessionFile[];
}

/**
 * 列出这个工作目录下的会话文件。目录不存在不是错误 —— 一次都没跑过就是这样。
 */
export function readSessions(agentDir: string, cwd: string): SessionSummary {
	const dir = sessionDirPath(agentDir, cwd);
	let names: string[];
	try {
		names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
	} catch {
		return { agentDir, cwd, dir, dirExists: false, sessions: [] };
	}

	const sessions: SessionFile[] = [];
	for (const name of names.sort()) {
		const path = join(dir, name);
		try {
			const text = readFileSync(path, "utf8");
			sessions.push({
				name,
				path,
				bytes: statSync(path).size,
				lines: text === "" ? 0 : text.split("\n").filter((line) => line !== "").length,
			});
		} catch {
			// 读不了就跳过：列目录是给人看的，不该因为一个文件坏掉就全失败。
			continue;
		}
	}
	return { agentDir, cwd, dir, dirExists: true, sessions };
}

export interface SessionRecord {
	readonly type: string;
	readonly raw: Record<string, unknown>;
}

/** 把一个会话文件读成记录。第一行是会话头（`--mode json` 的那种头也在里面）。 */
export function readSessionFile(path: string): readonly SessionRecord[] {
	const text = readFileSync(path, "utf8");
	const records: SessionRecord[] = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		try {
			const parsed = JSON.parse(line) as unknown;
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				const raw = parsed as Record<string, unknown>;
				records.push({ type: typeof raw.type === "string" ? raw.type : "（没有 type）", raw });
				continue;
			}
			records.push({ type: "（不是对象）", raw: {} });
		} catch {
			records.push({ type: "（不是 JSON）", raw: {} });
		}
	}
	return records;
}

/** 会话文件的文件名是 `<ISO 时间>_<uuid>.jsonl`；排序就等于时间排序。 */
export function newestSession(summary: SessionSummary): SessionFile | undefined {
	return summary.sessions.length > 0 ? summary.sessions[summary.sessions.length - 1] : undefined;
}

export function renderSessionSummary(summary: SessionSummary): string {
	const lines = [
		`agent 目录：${summary.agentDir}`,
		`工作目录：${summary.cwd}`,
		`会话目录：${summary.dir}${summary.dirExists ? "" : "（还没有）"}`,
	];
	if (summary.sessions.length === 0) {
		lines.push("  里面没有会话文件。");
		return lines.join("\n");
	}
	for (const session of summary.sessions) {
		lines.push(`  ${session.name}  ${session.bytes} 字节，${session.lines} 条记录`);
	}
	return lines.join("\n");
}
