/**
 * 第 1 章的命令行入口。四个子命令，每个回答一个问题：
 *
 *   bare      裸循环跑一遍，看事件顺序
 *   harness   同一个剧本套上 harness，看多了什么
 *   layers    给两棵源码树分层，看重量分布
 *   classify  给单个文件分层，看规则怎么落地
 *
 * 零依赖，不联网，不需要 API key。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { runWithHarness, describeContext, memorySessionStore, resumeContext } from "./harness.ts";
import { classifyFile, tallyLayers, replacementCost } from "./layers.ts";
import type { Layer } from "./layers.ts";
import { runLoop } from "./loop.ts";
import type { LoopResult } from "./loop.ts";
import { failingModel, scriptedModel } from "./model.ts";
import type { Step } from "./model.ts";
import { createListDirTool, createReadFileTool, createWriteFileTool } from "./tools.ts";
import type { AgentEvent, Context, Tool } from "./types.ts";

/** 用法错误与内部错误要能分开。见 1.7 的规则表。 */
export class UsageError extends Error {}

function parseFlags(argv: readonly string[]): Map<string, string | true> {
	const flags = new Map<string, string | true>();
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token || !token.startsWith("--")) throw new UsageError(`不认识的参数：${token ?? "(空)"}`);
		const name = token.slice(2);
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith("--")) {
			flags.set(name, next);
			i += 1;
		} else {
			flags.set(name, true);
		}
	}
	return flags;
}

function stringFlag(flags: Map<string, string | true>, name: string): string | undefined {
	const value = flags.get(name);
	return typeof value === "string" ? value : undefined;
}

const ALL_TOOLS: readonly Tool[] = [createReadFileTool(), createListDirTool(), createWriteFileTool()];

function printEvents(events: readonly AgentEvent[]): void {
	for (const event of events) {
		switch (event.type) {
			case "turn_end":
				console.log(`    turn_end（${event.toolResults.length} 条工具结果）`);
				break;
			case "message_start":
				console.log(`    message_start（${event.message.role}）`);
				break;
			case "message_end":
				console.log(`    message_end（${event.message.role}）`);
				break;
			case "tool_execution_start":
				console.log(`    tool_execution_start  ${event.toolName}`);
				break;
			case "tool_execution_end":
				console.log(`    tool_execution_end    ${event.toolName}${event.isError ? "（失败）" : ""}`);
				break;
			default:
				console.log(`    ${event.type}`);
		}
	}
}

// ── bare ────────────────────────────────────────────────────────────────

function cmdBare(flags: Map<string, string | true>): number {
	const steps: Step[] = [
		{ kind: "call", name: "list_dir", args: { path: stringFlag(flags, "path") ?? "." } },
		{ kind: "say", text: "看完了，目录里没什么特别的。" },
	];
	const events: AgentEvent[] = [];
	const context: Context = {
		systemPrompt: "你是一个助手。",
		tools: ALL_TOOLS.map((tool) => tool.spec),
		messages: [],
	};

	console.log("裸循环：没有 harness，没有会话，没有系统提示词构建\n");
	const result = runLoop({
		model: scriptedModel(steps),
		tools: ALL_TOOLS,
		context,
		emit: (event) => events.push(event),
	});

	printEvents(events);
	console.log(`\n停止原因：${result.stopKind}，轮数：${result.turns}，消息：${result.messages.length} 条`);
	return 0;
}

// ── harness ─────────────────────────────────────────────────────────────

function cmdHarness(flags: Map<string, string | true>): number {
	const readOnly = flags.has("read-only");
	const cwd = stringFlag(flags, "path") ?? ".";
	const steps: Step[] = [
		{ kind: "call", name: "list_dir", args: { path: cwd } },
		{ kind: "call", name: "read_file", args: { path: join(cwd, "README.md") } },
		{ kind: "say", text: "读完了。" },
	];

	const session = memorySessionStore(cwd, () => "1970-01-01T00:00:00.000Z");
	console.log(`套上 harness：${readOnly ? "只读模式" : "读写模式"}\n`);

	const run = runWithHarness({
		cwd,
		model: scriptedModel(steps),
		allTools: ALL_TOOLS,
		prompt: {
			base: "你是一个会读代码的助手。",
			projectContext: [{ path: join(cwd, "AGENTS.md"), content: "（这里放项目说明）" }],
			appended: "（这里放扩展追加的一段）",
		},
		session,
		now: () => "1970-01-01T00:00:00.000Z",
		userMessage: `看一下 ${cwd} 里有什么，然后读一下它的 README。`,
		readOnly,
		maxTurns: 6,
	});

	console.log(`工具集：${run.selection.active.map((t) => t.spec.name).join(", ")}`);
	for (const item of run.selection.excluded) {
		console.log(`  摘掉 ${item.name}：${item.reason}`);
	}
	console.log(`\n系统提示词 ${run.systemPrompt.length} 字符：`);
	console.log(
		run.systemPrompt
			.split("\n")
			.map((line) => `  | ${line}`)
			.join("\n"),
	);
	console.log(`\n上下文摊开：`);
	console.log(
		describeContext(run.context)
			.split("\n")
			.map((line) => `  ${line}`)
			.join("\n"),
	);
	console.log(`\n会话记录 ${session.records.length} 条：`);
	for (const record of session.records) {
		console.log(`  ${record.kind}${record.kind === "stop" ? `（${record.stopKind}）` : ""}`);
	}
	console.log(`\n停止原因：${run.result.stopKind}，轮数：${run.result.turns}`);

	// 把会话记录重新读回上下文——这就是「恢复会话」的全部内容：
	// 一个只读的历史文件加上一次重放，不需要循环提供任何专门接口。
	const resumed = resumeContext(session, run.systemPrompt, run.selection.active);
	console.log(
		`\n从会话记录重建：${resumed.messages.length} 条消息（内存里 ${run.context.messages.length} 条）` +
			`\n  对得上：${resumed.messages.length === run.context.messages.length}`,
	);
	return 0;
}

// ── exits：五条停下来时的样子 ───────────────────────────────────────────

/**
 * 「循环什么时候停」比「循环怎么转」更值得先看清楚。
 *
 * 五种停法里有四种是 pi 本来就有的出口，第五种（轮数上限）是本例加的保险。
 * 注意**输出被截断不在这个列表里**——它不是出口，是「这一批不算，重来」，
 * 所以那一格的结果是「继续跑完两轮之后正常收尾」。
 */
function cmdExits(): number {
	const context: Context = { systemPrompt: "", tools: [], messages: [] };
	const loopDir = (path: string): Step => ({ kind: "call", name: "list_dir", args: { path } });

	/** 一个要求停的工具。和 `terminate` 一起看：停不停挂在结果上，不挂在工具上。 */
	const finalTool: Tool = {
		spec: { name: "final_answer", description: "给出最终答案并要求循环停下", parameters: { text: true } },
		execute: (args) => ({
			content: [{ type: "text", text: String(args.text ?? "") }],
			details: "final_answer",
			isError: false,
			terminate: true,
		}),
	};

	const cases: readonly { readonly label: string; readonly note: string; readonly run: () => LoopResult }[] = [
		{
			label: "模型没有工具调用",
			note: "最正常的一种：模型直接回话，这一轮结束",
			run: () => runLoop({ model: scriptedModel([{ kind: "say", text: "我看完了，没什么特别的。" }]), tools: ALL_TOOLS, context }),
		},
		{
			label: "这一批工具全部要求停",
			note: "pi 用 every 判：一批里只要有一条不要求停，就继续跑",
			run: () =>
				runLoop({
					model: scriptedModel([
						{ kind: "call", name: "final_answer", args: { text: "答案是 42。" } },
					]),
					tools: [...ALL_TOOLS, finalTool],
					context,
				}),
		},
		{
			label: "模型报错",
			note: "不跑工具、不问宿主，直接退出（对照 agent-loop.ts:215-219）",
			run: () => runLoop({ model: failingModel(1), tools: ALL_TOOLS, context }),
		},
		{
			label: "宿主叫停",
			note: "每一轮结束后宿主都有一次否决权，包括没有工具调用的那一轮",
			run: () =>
				runLoop({
					model: scriptedModel([loopDir("."), { kind: "say", text: "还想再来一轮" }]),
					tools: ALL_TOOLS,
					context,
					shouldStopAfterTurn: ({ turn }) => turn >= 1,
				}),
		},
		{
			label: "撞上轮数上限",
			note: "本例自己加的保险，pi 的循环里没有这个开关",
			run: () =>
				runLoop({
					model: scriptedModel(Array.from({ length: 10 }, () => loopDir("."))),
					tools: ALL_TOOLS,
					context,
					maxTurns: 3,
				}),
		},
	];

	for (const item of cases) {
		const result = item.run();
		const last = result.messages[result.messages.length - 1];
		console.log(`  ${item.label}`);
		console.log(`    停止原因 ${result.stopKind}，${result.turns} 轮，最后一条是 ${last?.role ?? "(无)"}`);
		console.log(`    ${item.note}`);
	}

	// 单独列出来，因为它是**唯一一条看起来像出口、其实不是**的路径。
	const truncated = runLoop({
		model: scriptedModel([
			{ kind: "call", name: "list_dir", args: { path: "." }, truncated: true },
			{ kind: "say", text: "参数被截断了，我重发一次。" },
		]),
		tools: ALL_TOOLS,
		context,
	});
	console.log(`  （对照）模型输出被截断`);
	console.log(`    停止原因 ${truncated.stopKind}，${truncated.turns} 轮——不是出口，是重来一次`);
	console.log(`    整批不执行，回给模型一条 isError 的结果，让它带完整参数重发`);
	return 0;
}

// ── layers ──────────────────────────────────────────────────────────────

/** 按 BASELINE 的口径：只算 src/ 下的 .ts/.tsx，跳过测试。 */
const SKIP = /(\.test\.tsx?$|\.spec\.tsx?$|\/node_modules\/|\/dist\/)/;

function walk(dir: string, root: string, out: [string, number][]): void {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		let stat;
		try {
			stat = statSync(full);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			walk(full, root, out);
			continue;
		}
		if (!/\.tsx?$/.test(entry)) continue;
		const rel = relative(root, full);
		if (SKIP.test(rel)) continue;
		// 按 `wc -l` 的口径数换行符，不用 split("\n").length——
		// 后者会把文件末尾的换行多算一行，41 个文件就多出 41 行，跟 BASELINE 对不上。
		const lines = (readFileSync(full, "utf8").match(/\n/g) ?? []).length;
		out.push([rel, lines]);
	}
}

function cmdLayers(flags: Map<string, string | true>): number {
	const target = stringFlag(flags, "repo");
	if (!target) throw new UsageError("layers 需要 --repo <path>");

	const entries: [string, number][] = [];
	walk(target, target, entries);
	const tally = tallyLayers(entries);

	console.log(`${target}：${entries.length} 个文件\n`);
	for (const item of tally) {
		const bar = "█".repeat(Math.max(1, Math.round(item.lines / 500)));
		console.log(`  ${item.layer.padEnd(9)} ${String(item.lines).padStart(7)} 行 ${String(item.files).padStart(4)} 文件  ${bar}`);
	}
	console.log(`\n${replacementCost(tally)}`);
	return 0;
}

// ── classify ────────────────────────────────────────────────────────────

function cmdClassify(flags: Map<string, string | true>): number {
	const target = stringFlag(flags, "file");
	if (!target) throw new UsageError("classify 需要 --file <path>");
	const content = readFileSync(target, "utf8");
	const result = classifyFile(target, content);
	const layerNames: Record<Layer, string> = {
		provider: "provider —— 某一家模型的协议适配",
		runtime: "runtime —— 循环本身",
		harness: "harness —— 给循环接线",
		product: "product —— 产品层",
	};
	console.log(`${target}\n  → ${layerNames[result.layer]}`);
	console.log(`  依据：${result.hits.join("，")}`);
	console.log(`  为什么这么分：${result.why}`);
	return 0;
}

// ── 入口 ────────────────────────────────────────────────────────────────

const HELP = `用法：npm start -- <子命令> [选项]

  bare [--path <dir>]        裸循环跑一遍剧本，打印事件顺序
  harness [--path <dir>] [--read-only]
                             同一个剧本套上 harness，看多了什么
  exits                      五种停下时的样子，外加「截断不是出口」的对照
  layers --repo <path>       给一棵源码树分层
  classify --file <path>     给单个文件分层`;

export function main(argv: readonly string[]): number {
	try {
		const [sub, ...rest] = argv;
		if (!sub || sub === "help" || sub === "--help") {
			console.log(HELP);
			return 0;
		}
		const flags = parseFlags(rest);
		switch (sub) {
			case "bare":
				return cmdBare(flags);
			case "harness":
				return cmdHarness(flags);
			case "exits":
				return cmdExits();
			case "layers":
				return cmdLayers(flags);
			case "classify":
				return cmdClassify(flags);
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

process.exitCode = main(process.argv.slice(2));
