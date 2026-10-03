/**
 * 假的 agent：脚本说了算，不问模型。这是本章的第二个关键取舍。
 *
 * 真的 eval 要打模型，也就意味着要联网、要花钱、结果每次都不一样。但回归测试真正
 * 容易坏的地方不在模型身上，而在你自己这层：改了系统提示、换了一个工具的边界检查、
 * 调了判分的口径——这些都能用脚本化的假 agent 精确复现，而且每次结论一样。
 *
 * 所以这里把 agent 拆成两半：
 *   - 工具：真的跑（在临时目录里建目录、写文件），所以「世界变成什么样」是真的
 *   - 模型：假的，按脚本一条条吐 tool_call 和 response
 * 这样模型那半是确定的，工具那半是真的。测试红了，只可能是接线变了。
 *
 * 脚本写成一段段文本，每段是一次模型回合：
 *
 *     const script = [
 *       `tool: read_file {"path": "package.json"}`,
 *       `tool: write_file {"path": "src/hello.ts", "content": "..."}\n写好了。`,
 *     ];
 *
 * 以 `tool: 名字 {JSON}` 开头的行是一次工具调用，其余行拼成这一回合的回复正文。
 * 工具报错就中断脚本，回一句带原因的失败——真 agent 遇到工具报错也是这个走向。
 *
 * 这个例子的假模型读不懂系统提示，所以「换提示词」这类差异在这里表达不出来，
 * 只能靠工具和 prepare。要测提示词差异，得把假模型换成真的（见 README「本例没做的」）。
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent, JsonValue, RunResult } from "./types.ts";

export interface ToolContext {
	/** agent 的工作目录，工具的相对路径都从这里算 */
	readonly cwd: string;
	/** 包住 cwd 的沙箱目录。cwd 之外的路径都算「外面」，判分时要能看到 */
	readonly root: string;
}

export interface Tool {
	readonly name: string;
	readonly run: (args: Record<string, JsonValue>, context: ToolContext) => { readonly ok: boolean; readonly error?: string };
}

export interface Harness {
	/** 名字在同一个 eval 集里必须唯一，报告里用它认人。基线和候选各占一个 */
	readonly name: string;
	readonly tools: readonly Tool[];
	/** 每次运行前布置工作目录。基线不布置，候选才铺脚手架——差异就出在这里 */
	readonly prepare?: (context: ToolContext) => void;
}

/**
 * 跑一次要的全部输入。
 *
 * `setUp` 和 harness 的 `prepare` 是两件事，顺序不能换：
 *
 *   setUp      布置「用户的世界」——项目里已有的文件。同一个用例的所有方案看到的是同一份
 *   prepare    布置「方案自己的世界」——候选才铺的脚手架。差异就该出在这里
 *
 * 合成一个回调的代价是很实在的：基线和候选看到的初始现场不一样了，跑出来的差值
 * 就说不清是工具改的，还是现场本来就不一样。
 */
export interface RunInput {
	readonly script: readonly string[];
	readonly setUp?: (context: ToolContext) => void;
	/** 脚本跑完、目录还在的时候拍一张现场照。落盘要用的事实必须在这里取走 */
	readonly inspect?: (context: ToolContext) => Record<string, JsonValue>;
	readonly usage?: { readonly totalMs?: number; readonly estimatedCostUsd?: number; readonly totalTokens?: number };
}

const TOOL_CALL_PREFIX = "tool:";

function parseToolLine(line: string): { name: string; args: Record<string, JsonValue> } {
	const rest = line.slice(TOOL_CALL_PREFIX.length).trim();
	const space = rest.indexOf(" ");
	const name = space === -1 ? rest : rest.slice(0, space);
	const argText = space === -1 ? "{}" : rest.slice(space + 1).trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(argText);
	} catch (error) {
		throw new Error(`脚本里的工具参数不是 JSON：${argText}（${error instanceof Error ? error.message : String(error)}）`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`脚本里的工具参数必须是对象：${argText}`);
	}
	return { name, args: parsed as Record<string, JsonValue> };
}

function scriptLines(turn: string): string[] {
	return turn
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

export interface ScriptOutcome {
	readonly events: AgentEvent[];
	/** 最后一次模型回合的正文 */
	readonly output: string;
	readonly toolCalls: number;
}

/**
 * 按脚本跑一遍。事件顺序和真 agent 一样：先 tool_call（模型要调），再 tool_result（工具回话）。
 *
 * 脚本里写了不存在的工具名，直接抛——那是脚本自己的 bug，不该被当成「agent 的行为差异」
 * 记进分数里。这一点和断言层的取舍相反：断言记下来，脚本错误炸出来。
 */
export function runScript(harness: Harness, script: readonly string[], context: ToolContext): ScriptOutcome {
	const byName = new Map(harness.tools.map((tool) => [tool.name, tool]));
	const events: AgentEvent[] = [];
	let output = "";
	let toolCalls = 0;

	for (const turn of script) {
		const prose: string[] = [];
		let interrupted: string | undefined;

		for (const line of scriptLines(turn)) {
			if (!line.startsWith(TOOL_CALL_PREFIX)) {
				prose.push(line);
				continue;
			}
			const { name, args } = parseToolLine(line);
			const tool = byName.get(name);
			if (!tool) {
				throw new Error(`${harness.name} 没有名为 ${name} 的工具（有：${[...byName.keys()].join(", ")}）`);
			}
			toolCalls += 1;
			events.push({ type: "tool_call", name, args });
			const result = tool.run(args, context);
			events.push({
				type: "tool_result",
				name,
				result: result.ok ? { ok: true } : { ok: false, ...(result.error ? { error: result.error } : {}) },
			});
			if (!result.ok) {
				interrupted = `${name} 失败：${result.error ?? "没有给原因"}`;
				break;
			}
		}

		if (interrupted) {
			events.push({ type: "error", message: interrupted });
			output = `没能完成：${interrupted}`;
			events.push({ type: "response", content: output });
			return { events, output, toolCalls };
		}
		if (prose.length > 0) output = prose.join("\n");
		events.push({ type: "response", content: output });
	}

	return { events, output, toolCalls };
}

/**
 * 在临时沙箱里跑一次。每次新建、跑完就删（`finally` 里删，抛异常也删），
 * 和 pi 的 eval harness 一个做法（`pi-harness.ts:122-130`、`:228-232`）。
 * 两次运行之间不共享任何状态，也就不会出现「单独跑能过、连着跑就挂」。
 *
 * cwd 是 root 下的 work/，故意让外面还空着一层——越界的路径落在 root 里而不是 /tmp 里，
 * 一次运行污染不到下一次。
 */
export function runInWorkspace(harness: Harness, input: RunInput): RunResult {
	const root = mkdtempSync(join(tmpdir(), "ch23-eval-"));
	const context: ToolContext = { cwd: join(root, "work"), root };
	try {
		mkdirSync(context.cwd, { recursive: true });
		input.setUp?.(context);
		harness.prepare?.(context);
		const { events, output, toolCalls } = runScript(harness, input.script, context);
		return {
			output,
			events,
			usage: { provider: "scripted", model: harness.name, toolCalls, ...(input.usage ?? {}) },
			artifacts: input.inspect ? input.inspect(context) : {},
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
