/**
 * 装完 pi 之后先跑这个：环境对不对，一眼看完。
 *
 * 规则：**只打名字和结论，不打值。** auth.json 里是凭据，环境变量里可能有
 * API key —— 一个"体检"命令把凭据打到终端（还可能被贴进 issue）是常见事故。
 * 所以这里只回答"在不在""权限对不对"，永远不回答"是什么"。
 *
 * 检查项都来自 pi 的代码，不是这里的发明：
 *   - Node 版本下限：pi 根 package.json:62-63 的 engines.node
 *     （packages/coding-agent/package.json:103-104 写的是同一个值）
 *   - agent 目录：config.ts:524-530 默认 `<home>/.pi/agent`，config.ts:503-504 可被覆盖
 *   - 目录里的文件：auth.json / models-store.json / trust.json / settings.json
 *   - provider 的 API key 变量名：ai/src/env-api-keys.ts:79-116 的 envMap
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AGENT_DIR_FILES, DEFAULT_AGENT_SUBDIR, ENV_AGENT_DIR, ENV_FLAGS, MIN_NODE, PROVIDER_ENV_KEYS } from "./constants.ts";

export type CheckLevel = "ok" | "warn" | "fail";

export interface Check {
	readonly level: CheckLevel;
	readonly name: string;
	readonly detail: string;
}

export interface DoctorInput {
	/** process.versions.node */
	readonly nodeVersion: string;
	/** 实际的 agent 目录。默认值在 config.ts:529。 */
	readonly agentDir: string;
	/** 用哪个变量覆盖的 agent 目录；没覆盖就是 undefined。 */
	readonly agentDirEnvVar?: string;
	/** 环境变量表。只读名字和"有没有值"。 */
	readonly env: Record<string, string | undefined>;
	/** 读文件权限；测试里替换掉，不碰真磁盘。 */
	readonly statFile?: (path: string) => { readonly mode: number } | undefined;
}

const SEVERITY: Record<CheckLevel, number> = { ok: 0, warn: 1, fail: 2 };

/** 版本比较：只比前三段数字，够用。 */
export function compareVersions(a: string, b: readonly [number, number, number]): number {
	const parts = a.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10));
	for (let i = 0; i < 3; i += 1) {
		const left = Number.isFinite(parts[i]) ? parts[i] : 0;
		if (left !== b[i]) return left < b[i] ? -1 : 1;
	}
	return 0;
}

export function checkNode(nodeVersion: string): Check {
	const [major, minor, patch] = MIN_NODE;
	const required = `${major}.${minor}.${patch}`;
	if (compareVersions(nodeVersion, MIN_NODE) < 0) {
		return { level: "fail", name: "Node 版本", detail: `${nodeVersion} 低于要求的 ${required}（package.json:103-104）` };
	}
	return { level: "ok", name: "Node 版本", detail: `${nodeVersion} ≥ ${required}` };
}

export function checkAgentDir(input: DoctorInput): Check {
	const source = input.agentDirEnvVar ? `来自 ${input.agentDirEnvVar}` : "默认位置（config.ts:529）";
	return { level: "ok", name: "agent 目录", detail: `${input.agentDir}（${source}）` };
}

/**
 * agent 目录里的文件。私有文件权限必须是 0600 —— 这几个文件里有凭据。
 * 权限不对是 warn 不是 fail：pi 还能跑，但值得现在修。
 */
export function checkAgentFiles(input: DoctorInput): readonly Check[] {
	const statFile = input.statFile ?? defaultStatFile;
	const checks: Check[] = [];
	for (const file of AGENT_DIR_FILES) {
		const path = join(input.agentDir, file.name);
		const stat = statFile(path);
		if (stat === undefined) {
			checks.push({
				level: "ok",
				name: file.name,
				detail: "还没有（pi 需要时会自己建）",
			});
			continue;
		}
		const mode = stat.mode & 0o777;
		if (file.private && mode !== 0o600) {
			checks.push({
				level: "warn",
				name: file.name,
				detail: `权限是 ${mode.toString(8)}，建议 600：这个文件里有凭据`,
			});
			continue;
		}
		checks.push({ level: "ok", name: file.name, detail: `在，权限 ${mode.toString(8)}` });
	}
	return checks;
}

function defaultStatFile(path: string): { readonly mode: number } | undefined {
	try {
		return statSync(path);
	} catch {
		return undefined;
	}
}

/**
 * 凭据有没有配。只看名字在不在、值非不非空，**不看值**。
 * 变量名来自 ai/src/env-api-keys.ts:79-116 的 envMap。
 */
export function checkCredentials(env: Record<string, string | undefined>): readonly Check[] {
	const present = PROVIDER_ENV_KEYS.filter((name) => (env[name] ?? "") !== "");
	if (present.length === 0) {
		return [
			{
				level: "warn",
				name: "provider 凭据",
				detail: `没看到 ${PROVIDER_ENV_KEYS.length} 个已知变量中的任何一个（名字：${PROVIDER_ENV_KEYS.join(", ")}）。可以改用 auth.json 登录`,
			},
		];
	}
	return [{ level: "ok", name: "provider 凭据", detail: `已设置：${present.join(", ")}（只看名字，不看值）` }];
}

/** 影响 pi 行为的开关，同样只说设没设。 */
export function checkEnvFlags(env: Record<string, string | undefined>): Check {
	const set = ENV_FLAGS.filter((name) => (env[name] ?? "") !== "");
	if (set.length === 0) return { level: "ok", name: "环境开关", detail: "一个都没设" };
	return { level: "ok", name: "环境开关", detail: `已设置：${set.join(", ")}` };
}

export function runChecks(input: DoctorInput): readonly Check[] {
	return [
		checkNode(input.nodeVersion),
		checkAgentDir(input),
		...checkAgentFiles(input),
		...checkCredentials(input.env),
		checkEnvFlags(input.env),
	];
}

/** 最严重的一项。doctor 用它决定退出码。 */
export function worstLevel(checks: readonly Check[]): CheckLevel {
	return checks.reduce<CheckLevel>((worst, check) => (SEVERITY[check.level] > SEVERITY[worst] ? check.level : worst), "ok");
}

export function renderChecks(checks: readonly Check[]): string {
	const mark: Record<CheckLevel, string> = { ok: "✓", warn: "!", fail: "✗" };
	const lines = ["pi 环境体检：", ""];
	for (const check of checks) lines.push(`  ${mark[check.level]} ${check.name}：${check.detail}`);
	const worst = worstLevel(checks);
	lines.push("");
	lines.push(worst === "ok" ? "没发现问题。" : worst === "warn" ? "有可以改进的地方，但不影响跑起来。" : "有必须先解决的问题。");
	return lines.join("\n");
}

/** 默认的 agent 目录。config.ts:503-504 优先看环境变量。 */
export function defaultAgentDir(home: string, env: Record<string, string | undefined>): {
	readonly agentDir: string;
	readonly envVar?: string;
} {
	const override = env[ENV_AGENT_DIR];
	if (override !== undefined && override !== "") return { agentDir: override, envVar: ENV_AGENT_DIR };
	return { agentDir: join(home, ".pi", DEFAULT_AGENT_SUBDIR) };
}

/** 顺手确认一下 auth.json 是能解析的 JSON —— 不打印内容。 */
export function authFileIsReadable(path: string): boolean {
	try {
		JSON.parse(readFileSync(path, "utf8"));
		return true;
	} catch {
		return false;
	}
}
