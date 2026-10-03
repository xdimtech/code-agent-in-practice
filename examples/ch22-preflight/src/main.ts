/**
 * 第 22 章的命令行入口。五个子命令，每个对应一件事：
 *
 *   checklist    pi 开箱 vs 装了本例扩展，五项各是什么状态
 *   env          一份示例环境过白名单，留下谁、拿掉谁（只打印名字）
 *   loop         刹车怎么数：同一个调用、改完再跑、用 bash 改
 *   install-lab  临时目录里真跑 npm install，三种写法下安装脚本跑没跑
 *   probe        当前运行时下，没人接的拒绝落在哪
 *
 * 零依赖，不联网，不需要 API key。
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluate, exitCode, outOfBox, render } from "./checklist.ts";
import { runtimeOf, SCENARIOS } from "./crash.ts";
import { DEFAULT_ENV_POLICY, denylistOnlyKeeps, filterEnv, type Env } from "./env-filter.ts";
import { FAKE_TOKEN_NAME, runInstallLab } from "./install-lab.ts";
import { installScriptStatus } from "./install-scripts.ts";
import { parseSettings } from "./settings.ts";
import { DEFAULT_LIMITS, initialState, onToolCall, type GuardState } from "./loop-guard.ts";
import { installPreflight, type PiLike } from "../extension/wiring.ts";

export class UsageError extends Error {}

const HERE = dirname(fileURLToPath(import.meta.url));

function flagValue(argv: readonly string[], name: string): string | undefined {
	const index = argv.indexOf(`--${name}`);
	if (index < 0) return undefined;
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) throw new UsageError(`--${name} 后面要跟一个值`);
	return value;
}

// ── checklist ───────────────────────────────────────────────────────────

/** 设置文件是用户给的：读不到、格式不对都算用法错误，退出码 2 */
function readNpmCommand(path: string): readonly string[] | undefined {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		throw new UsageError(`读不了 ${path}：${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		return parseSettings(text).npmCommand;
	} catch (error) {
		throw new UsageError(`${path}：${error instanceof Error ? error.message : String(error)}`);
	}
}

/** 什么都不做的 pi：只为了让 installPreflight 真跑一遍，从它那里拿事实 */
const silentPi: PiLike = { on: () => {}, registerTool: () => {}, registerCommand: () => {} };
const silentProcess = { on: () => silentProcess, off: () => silentProcess };
const noopOps = { exec: async () => ({ exitCode: 0 }) };

function cmdChecklist(argv: readonly string[]): number {
	const settingsPath = flagValue(argv, "settings");
	const npmCommand = settingsPath ? readNpmCommand(settingsPath) : undefined;
	const installFacts = { npmCommand, env: process.env };
	const runtime = runtimeOf(process.versions);

	console.log(`pi 开箱（运行时 ${runtime}${settingsPath ? `，设置 ${settingsPath}` : ""}）\n`);
	const before = evaluate(outOfBox(runtime, installScriptStatus(installFacts)));
	console.log(render(before));

	const gate = () => undefined;
	const preflight = installPreflight(silentPi, {
		cwd: ".",
		createBashToolDefinition: () => ({}),
		createLocalBashOperations: () => noopOps,
		baseEnv: () => ({}),
		process: silentProcess,
		runtime,
		installFacts: () => installFacts,
		toolCallGate: gate,
		userBashGate: gate,
	});
	console.log(`\n装上本例扩展（含第 15 章的确认）\n`);
	const after = evaluate(preflight.facts());
	console.log(render(after));
	console.log(`\n必补全部到位：${exitCode(after) === 0 ? "是" : "否"}`);
	return exitCode(after);
}

// ── env ─────────────────────────────────────────────────────────────────

/** 示例环境。值全是占位符，本命令也只打印名字 */
export const SAMPLE_ENV: Env = Object.fromEntries(
	[
		"PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR", "PI_SESSION_ID",
		"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "NPM_TOKEN",
		"DATABASE_URL", "REDIS_URL", "HTTPS_PROXY", "SENTRY_DSN", "KUBECONFIG", "SSH_AUTH_SOCK", "npm_config_ignore_scripts",
	].map((name) => [name, "<placeholder>"]),
);

function cmdEnv(argv: readonly string[]): number {
	const real = argv.includes("--real");
	const env = real ? process.env : SAMPLE_ENV;
	const { kept, dropped } = filterEnv(env, DEFAULT_ENV_POLICY);
	const denyKeeps = denylistOnlyKeeps(env);
	const slipped = denyKeeps.filter((name) => !kept.includes(name));
	console.log(`${real ? "当前进程的环境" : "示例环境"}：${kept.length + dropped.length} 个变量（只列名字，不列值）\n`);
	console.log(`  白名单留下 ${kept.length}：${kept.join(" ")}`);
	console.log(`  白名单拿掉 ${dropped.length}：${real ? "（名字不打印，免得泄露你用了哪些服务）" : dropped.join(" ")}`);
	console.log(`\n  只用黑名单会多放过 ${slipped.length} 个${real ? "" : `：${slipped.join(" ")}`}`);
	return 0;
}

// ── loop ────────────────────────────────────────────────────────────────

type Call = readonly [tool: string, input: Record<string, unknown>];

function replay(title: string, calls: readonly Call[]): void {
	console.log(`  ${title}`);
	let state: GuardState = initialState();
	for (const [tool, input] of calls) {
		const step = onToolCall(state, DEFAULT_LIMITS, tool, input);
		state = step.state;
		const shown = tool === "bash" ? String(input.command) : `${tool} ${String(input.path)}`;
		console.log(`    ${step.verdict.kind === "allow" ? "放行" : "拦下"}  第 ${step.verdict.count} 次  ${shown}`);
	}
}

function cmdLoop(): number {
	const test: Call = ["bash", { command: "npm test" }];
	const edit: Call = ["edit", { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] }];
	const sed: Call = ["bash", { command: "sed -i '' s/a/b/ src/a.ts" }];
	console.log(`上限：同一调用 ${DEFAULT_LIMITS.maxRepeats} 次，一次运行 ${DEFAULT_LIMITS.maxTurns} 轮\n`);
	replay("一、什么都没改，反复跑测试", [test, test, test, test]);
	replay("二、每次改完再跑（edit 换代）", [test, edit, test, edit, test, edit, test]);
	replay("三、用 bash 改文件（不换代，这是代价）", [test, sed, test, sed, test, sed, test]);
	return 0;
}

// ── install-lab ─────────────────────────────────────────────────────────

function cmdInstallLab(): number {
	console.log(`临时目录里装一个带 postinstall 的本地包，三种写法：\n`);
	for (const row of runInstallLab()) {
		const ran = row.ran ? "跑了" : "没跑";
		const saw = row.ran ? `，看见 ${FAKE_TOKEN_NAME}：${row.sawToken ? "是" : "否"}` : "";
		console.log(`  ${row.label}\n    退出码 ${row.exitCode}，安装脚本${ran}${saw}`);
	}
	return 0;
}

// ── probe ───────────────────────────────────────────────────────────────

function cmdProbe(): number {
	const script = join(HERE, "..", "scripts", "probe.ts");
	console.log(`运行时 ${runtimeOf(process.versions)} ${process.version}，先只挂一个 uncaughtException（模拟 pi），再 Promise.reject：\n`);
	for (const scenario of SCENARIOS) {
		const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, scenario], { encoding: "utf8" });
		const line = result.stdout.trim() || `（无输出，退出码 ${result.status}）`;
		console.log(`  ${scenario.padEnd(20)} ${line}`);
	}
	return 0;
}

// ── 入口 ────────────────────────────────────────────────────────────────

const HELP = `用法：npm start -- <子命令> [选项]

  checklist [--settings <settings.json>]  pi 开箱 vs 装了本例扩展
  env [--real]                            环境变量过白名单（只打印名字）
  loop                                    刹车怎么数
  install-lab                             临时目录里真跑 npm install
  probe                                   没人接的拒绝落在哪`;

export function main(argv: readonly string[]): number {
	try {
		const [sub, ...rest] = argv;
		switch (sub) {
			case undefined:
			case "help":
			case "--help":
				console.log(HELP);
				return 0;
			case "checklist":
				return cmdChecklist(rest);
			case "env":
				return cmdEnv(rest);
			case "loop":
				return cmdLoop();
			case "install-lab":
				return cmdInstallLab();
			case "probe":
				return cmdProbe();
			default:
				throw new UsageError(`不认识的子命令：${sub}`);
		}
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(`${error.message}\n\n${HELP}`);
			return 2;
		}
		throw error;
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
