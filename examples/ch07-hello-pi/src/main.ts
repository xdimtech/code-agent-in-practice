/**
 * 命令行入口。四个子命令，对应这一章的四个问题：
 *
 *   explain  这次运行到底发生了什么（读 --mode json 的输出，或 fixture）
 *   doctor   这台机器能不能跑（版本、目录、权限、凭据有没有配）
 *   script   不装 pi 也能看见脚本模型每一轮做什么
 *   session  跑完之后磁盘上留下了什么
 *
 * 退出码：0 正常，1 检查发现问题，2 用法错，70 内部错。
 * 这套码和后几章的例子一致（这一章只有一个数字特殊：doctor 的 1）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { runChecks, renderChecks, worstLevel, defaultAgentDir, type Check } from "./doctor.ts";
import { countByType, groupByTurn, parseNdjson, renderTimeline } from "./explain.ts";
import { runPi, createSandbox } from "./run.ts";
import { readSessions, renderSessionSummary, sessionDirName, newestSession, readSessionFile, resolveCwd } from "./session-file.ts";
import { describeContext, planNextTurn, stopReasonFor } from "./script.ts";
import { DEFAULT_FILE, DEFAULT_TOOL, lazySettings } from "./settings.ts";
import type { Context } from "./types.ts";

export const EXIT_OK = 0;
export const EXIT_CHECK_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_INTERNAL = 70;

const USAGE = `用法：
  ch07 explain [--json 文件] [--counts]     把一次 --mode json 的输出读成时间线
  ch07 doctor [--json]                      检查这台机器能不能跑 pi
  ch07 script [--file F] [--tool T] [--quiet]  不装 pi，看脚本模型每一轮做什么
  ch07 session [--agent-dir D] [--cwd C]    看会话目录与会话文件
  ch07 run [--pi 路径] [--file F]           在临时目录里真的跑一次 pi（需要已安装）`;

export async function main(argv: readonly string[], io = { out: process.stdout, err: process.stderr, env: process.env }): Promise<number> {
	const [command, ...rest] = argv;

	try {
		// 解析放在 try 里：用法错要用退出码 2，不能和内部错误一样是 70。
		const flags = parseFlags(rest);
		switch (command) {
			case "explain":
				return explain(flags, io);
			case "doctor":
				return doctor(flags, io);
			case "script":
				return script(flags, io);
			case "session":
				return session(flags, io);
			case "run":
				return await run(flags, io);
			case undefined:
			case "help":
			case "--help":
				io.out.write(`${USAGE}\n`);
				return EXIT_OK;
			default:
				io.err.write(`不认识的子命令：${command}\n\n${USAGE}\n`);
				return EXIT_USAGE;
		}
	} catch (error) {
		if (error instanceof UsageError) {
			io.err.write(`${error.message}\n\n${USAGE}\n`);
			return EXIT_USAGE;
		}
		// 内部错误：打印出来，但不吞掉 —— 这一章的例子里没有"静默失败"。
		io.err.write(`内部错误：${error instanceof Error ? error.message : String(error)}\n`);
		return EXIT_INTERNAL;
	}
}

interface Flags {
	readonly values: ReadonlyMap<string, string>;
	readonly booleans: ReadonlySet<string>;
}

/** 极小参数解析：`--k v` 和 `--k` 都收。不认识的选项按用法错处理。 */
function parseFlags(args: readonly string[]): Flags {
	const values = new Map<string, string>();
	const booleans = new Set<string>();
	const known = new Set(["json", "counts", "file", "tool", "quiet", "agent-dir", "cwd", "pi", "message"]);

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg.startsWith("--")) throw new UsageError(`多余的位置参数：${arg}`);
		const name = arg.slice(2);
		if (!known.has(name)) throw new UsageError(`不认识的选项：--${name}`);
		const next = args[index + 1];
		if (next === undefined || next.startsWith("--")) {
			booleans.add(name);
			continue;
		}
		values.set(name, next);
		index += 1;
	}
	return { values, booleans };
}

class UsageError extends Error {}

function explain(flags: Flags, io: Io): number {
	const path = flags.values.get("json");
	let text: string;
	if (path === undefined) {
		text = readFileSync(new URL("../fixtures/run-json.txt", import.meta.url), "utf8");
		io.out.write("（没有给 --json，用仓库里的 fixture：examples/ch07-hello-pi/fixtures/run-json.txt）\n\n");
	} else {
		text = readFileSync(path, "utf8");
	}

	const events = parseNdjson(text);
	const timeline = groupByTurn(events);
	io.out.write(`${renderTimeline(timeline)}\n`);

	if (flags.booleans.has("counts")) {
		io.out.write("\n按类型计数：\n");
		for (const [type, count] of [...countByType(events)].sort((a, b) => b[1] - a[1])) {
			io.out.write(`  ${String(count).padStart(3)}  ${type}\n`);
		}
	}
	return EXIT_OK;
}

function doctor(flags: Flags, io: Io): number {
	const resolved = defaultAgentDir(homedir(), io.env);
	const checks = runChecks({
		nodeVersion: process.versions.node,
		agentDir: resolved.agentDir,
		agentDirEnvVar: resolved.envVar,
		env: io.env,
	});

	if (flags.booleans.has("json")) {
		io.out.write(`${JSON.stringify({ checks, worst: worstLevel(checks) }, null, 2)}\n`);
	} else {
		io.out.write(`${renderChecks(checks)}\n`);
	}
	// 有 fail 才用 1；warn 不影响退出码 —— "建议"不该让脚本失败。
	return checks.some((check: Check) => check.level === "fail") ? EXIT_CHECK_FAILED : EXIT_OK;
}

function script(flags: Flags, io: Io): number {
	// 这里走的是懒读那条路：命令行 → 环境变量 → 默认值。
	const settings = lazySettings(
		(name) => {
			// 布尔旗标要回 true，不能回 "1"：resolveSettings 只认 true
			// （真实 pi 的 CLI 布尔旗标也是存成 true，core/agent-session-services.ts:107）。
			const map: Record<string, boolean | string | undefined> = {
				"demo-file": flags.values.get("file"),
				"demo-tool": flags.values.get("tool"),
				"demo-quiet": flags.booleans.has("quiet") ? true : undefined,
			};
			return map[name];
		},
		io.env,
	)();
	const message = flags.values.get("message") ?? "读一下";

	io.out.write(`设置：file=${settings.file} tool=${settings.tool} report=${settings.report}\n\n`);
	io.out.write("第一轮：上下文里只有用户那句话，所以调工具。\n");
	const first: Context = { messages: [{ role: "user", content: [{ type: "text", text: message }] }] };
	const plan1 = planNextTurn(first, settings);
	io.out.write(`  → ${plan1.kind === "toolCall" ? `${plan1.name}(${JSON.stringify(plan1.args)})` : plan1.text}\n`);
	io.out.write(`  → stopReason = ${stopReasonFor(plan1)}\n\n`);

	io.out.write("第二轮：上下文里多了一条 toolResult，所以收尾。\n");
	const second: Context = {
		...first,
		messages: [
			...first.messages,
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call_1", name: settings.tool, arguments: { path: settings.file } }],
				stopReason: "toolUse",
			},
			{
				role: "toolResult",
				toolCallId: "call_1",
				toolName: settings.tool,
				content: [{ type: "text", text: "（这里放工具读到的内容）\n第二行\n第三行" }],
				isError: false,
			},
		],
	};
	const plan2 = planNextTurn(second, settings);
	io.out.write(`  → ${plan2.kind === "text" ? `${plan2.text.split("\n")[0]}…（共 ${plan2.text.split("\n").length} 行）` : `${plan2.name}(...)`}\n`);
	io.out.write(`  → stopReason = ${stopReasonFor(plan2)}\n\n`);
	io.out.write("第二轮里模型真正收到的东西：\n");
	io.out.write(`${describeContext(second, settings.file)}\n`);
	return EXIT_OK;
}

function session(flags: Flags, io: Io): number {
	const resolved = defaultAgentDir(homedir(), io.env);
	const agentDir = flags.values.get("agent-dir") ?? resolved.agentDir;
	// 解析符号链接，和 pi 的口径一致（/tmp → /private/tmp）。
	const cwd = resolveCwd(flags.values.get("cwd") ?? process.cwd());
	const summary = readSessions(agentDir, cwd);
	io.out.write(`${renderSessionSummary(summary)}\n`);

	const newest = newestSession(summary);
	if (newest === undefined) return EXIT_OK;
	io.out.write(`\n最近一次会话 ${newest.name} 里的记录类型：\n`);
	const counts = new Map<string, number>();
	for (const record of readSessionFile(newest.path)) counts.set(record.type, (counts.get(record.type) ?? 0) + 1);
	for (const [type, count] of [...counts].sort((a, b) => b[1] - a[1])) {
		io.out.write(`  ${String(count).padStart(3)}  ${type}\n`);
	}
	io.out.write(`\n（目录名 ${sessionDirName(cwd)} 由 core/session-manager.ts:476-481 拼出来）\n`);
	return EXIT_OK;
}

async function run(flags: Flags, io: Io): Promise<number> {
	const sandbox = createSandbox();
	try {
		const extensionPath = new URL("../extension/scripted-provider.ts", import.meta.url).pathname;
		const result = await runPi(sandbox, {
			piBin: flags.values.get("pi"),
			args: [
				"-e",
				extensionPath,
				"--provider",
				"scripted",
				"--model",
				"hello",
				"--mode",
				"json",
				"--demo-file",
				flags.values.get("file") ?? DEFAULT_FILE,
				"--demo-tool",
				flags.values.get("tool") ?? DEFAULT_TOOL,
				flags.values.get("message") ?? "读一下",
			],
			files: { [DEFAULT_FILE]: "hello from hello.txt\n", "other.txt": "this is other.txt\n" },
			timeoutMs: 60_000,
		});

		io.out.write(`pi 退出码 ${result.code}${result.signal ? `（信号 ${result.signal}）` : ""}\n`);
		if (result.stderr !== "") io.err.write(`stderr：\n${result.stderr}\n`);
		io.out.write(`\n${renderTimeline(groupByTurn(parseNdjson(result.stdout)))}\n`);
		return result.code === 0 ? EXIT_OK : EXIT_CHECK_FAILED;
	} finally {
		sandbox.cleanup();
	}
}

interface Io {
	out: { write(text: string): unknown };
	err: { write(text: string): unknown };
	env: Record<string, string | undefined>;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error: unknown) => {
			process.stderr.write(`内部错误：${error instanceof Error ? error.stack : String(error)}\n`);
			process.exitCode = EXIT_INTERNAL;
		});
}
