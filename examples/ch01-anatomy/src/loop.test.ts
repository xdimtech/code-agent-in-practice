/**
 * 循环的行为测试。这里断言的都是**形状**，不是产物：
 * 事件顺序、停止原因、上下文怎么增长。
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectToolCalls, runLoop, toolResultMessage } from "./loop.ts";
import type { ModelFn } from "./loop.ts";
import { failingModel, scriptedModel } from "./model.ts";
import type { Step } from "./model.ts";
import { createListDirTool, createReadFileTool, createWriteFileTool } from "./tools.ts";
import type { AgentEvent, Context, Message, Tool } from "./types.ts";

const TOOLS: readonly Tool[] = [createReadFileTool(), createListDirTool(), createWriteFileTool()];

function emptyContext(): Context {
	return { systemPrompt: "test", tools: TOOLS.map((t) => t.spec), messages: [] };
}

function collect(options: Parameters<typeof runLoop>[0]): { result: ReturnType<typeof runLoop>; events: AgentEvent[] } {
	const events: AgentEvent[] = [];
	const result = runLoop({ ...options, emit: (event) => events.push(event) });
	return { result, events };
}

test("一轮说完就停：没有工具调用时 stopKind 是 no_tool_calls", () => {
	const { result, events } = collect({
		model: scriptedModel([{ kind: "say", text: "你好" }]),
		tools: TOOLS,
		context: emptyContext(),
	});

	assert.equal(result.stopKind, "no_tool_calls");
	assert.equal(result.turns, 1);
	assert.deepEqual(
		events.map((e) => e.type),
		["agent_start", "turn_start", "message_start", "message_end", "turn_end", "agent_end"],
	);
});

test("工具调用让循环多跑一轮", () => {
	const steps: Step[] = [
		{ kind: "call", name: "list_dir", args: { path: "." } },
		{ kind: "say", text: "看完了" },
	];
	const { result, events } = collect({ model: scriptedModel(steps), tools: TOOLS, context: emptyContext() });

	assert.equal(result.turns, 2);
	assert.equal(result.stopKind, "no_tool_calls");
	// 工具执行的事件必须夹在两次 turn_start 之间。
	const types = events.map((e) => e.type);
	assert.equal(types.filter((t) => t === "turn_start").length, 2);
	assert.ok(types.includes("tool_execution_start"));
	assert.ok(types.indexOf("tool_execution_start") < types.indexOf("turn_end"));
});

test("上下文按「用户 → 助手 → 工具结果 → 助手」的顺序增长", () => {
	const steps: Step[] = [
		{ kind: "call", name: "list_dir", args: { path: "." } },
		{ kind: "say", text: "完事" },
	];
	const { result } = collect({
		model: scriptedModel(steps),
		tools: TOOLS,
		context: { ...emptyContext(), messages: [{ role: "user", content: [{ type: "text", text: "看看" }] }] },
	});

	assert.deepEqual(
		result.messages.map((m) => m.role),
		["user", "assistant", "toolResult", "assistant"],
	);
});

test("未知工具不抛异常，而是变成一条 isError 的结果", () => {
	const { result } = collect({
		model: scriptedModel([{ kind: "call", name: "delete_everything", args: {} }, { kind: "say", text: "算了" }]),
		tools: TOOLS,
		context: emptyContext(),
	});

	const toolResult = result.messages.find((m) => m.role === "toolResult");
	assert.ok(toolResult);
	assert.equal(toolResult.isError, true);
	assert.equal(toolResult.toolName, "delete_everything");
	// 关键：循环没有崩，模型还有机会自己纠正。
	assert.equal(result.stopKind, "no_tool_calls");
	assert.equal(result.turns, 2);
});

test("模型报错：不跑工具，直接结束", () => {
	const { result, events } = collect({
		model: failingModel(1),
		tools: TOOLS,
		context: emptyContext(),
	});

	assert.equal(result.stopKind, "model_error");
	assert.equal(result.turns, 2);
	// 出错的那一轮不发 tool_execution_start。
	const lastTurnEnd = events.map((e) => e.type).lastIndexOf("turn_end");
	const lastToolStart = events.map((e) => e.type).lastIndexOf("tool_execution_start");
	assert.ok(lastToolStart < lastTurnEnd);
});

test("输出被截断：整批不执行，但循环不退出——模型拿到失败结果后重发", () => {
	const dir = mkdtempSync(join(tmpdir(), "ch01-trunc-"));
	const target = join(dir, "never.txt");
	const { result } = collect({
		model: scriptedModel([
			{ kind: "call", name: "write_file", args: { path: target, content: "半截" }, truncated: true },
			{ kind: "say", text: "我重发一次" },
		]),
		tools: TOOLS,
		context: emptyContext(),
	});

	// 不是一条退出路径：pi 的 failToolCallsFromTruncatedMessage 返回 terminate: false。
	assert.equal(result.stopKind, "no_tool_calls");
	assert.equal(result.turns, 2);
	// 写工具真的没跑——半截参数一旦执行，代价比重跑一次大得多。
	assert.equal(existsSync(target), false);
	const toolResult = result.messages.find((m) => m.role === "toolResult");
	assert.ok(toolResult);
	assert.equal(toolResult.isError, true);
	// 截断的结果说的是「没执行，请重发」，不是「执行失败」。
	const text = toolResult.content.map((b) => (b.type === "text" ? b.text : "")).join("");
	assert.match(text, /未执行/);
	assert.match(text, /重新发起/);
});

test("这次进上下文的消息都发 message_end：用户、助手、工具结果一个不漏", () => {
	const history: Message = { role: "user", content: [{ type: "text", text: "很早以前说的话" }] };
	const prompt: Message = { role: "user", content: [{ type: "text", text: "看看目录" }] };
	const { result, events } = collect({
		model: scriptedModel([{ kind: "call", name: "list_dir", args: { path: "." } }, { kind: "say", text: "好" }]),
		tools: TOOLS,
		context: { ...emptyContext(), messages: [history] },
		prompts: [prompt],
	});

	const ended = events.filter((e) => e.type === "message_end").map((e) => (e.type === "message_end" ? e.message : null));
	// 历史不再宣布；这次新增的四条按顺序各一次。
	assert.deepEqual(
		ended.map((m) => m?.role),
		["user", "assistant", "toolResult", "assistant"],
	);
	assert.ok(!ended.includes(history));
	// 于是：历史 + 所有 message_end 的消息 = 最终上下文。会话记录只要订阅这一个事件。
	assert.deepEqual([history, ...ended], [...result.messages]);
});

test("轮数上限是宿主的保险，不是模型的意愿", () => {
	const steps = Array.from({ length: 20 }, () => ({ kind: "call", name: "list_dir", args: { path: "." } }) as Step);
	const { result } = collect({ model: scriptedModel(steps), tools: TOOLS, context: emptyContext(), maxTurns: 3 });

	assert.equal(result.stopKind, "max_turns");
	assert.equal(result.turns, 3);
});

test("terminate：只有这一批全部要求停，才真的停", () => {
	// 按参数决定要不要停的工具。用它才造得出「一批里两条、结论不一致」的情况——
	// terminate 是每次执行各自算出来的，不是工具级的常量。
	const conditional: Tool = {
		spec: { name: "probe", description: "按参数决定停不停", parameters: { stop: true } },
		execute: (args) => ({
			content: [{ type: "text", text: args.stop === true ? "停" : "继续" }],
			details: "probe",
			isError: false,
			terminate: args.stop === true,
		}),
	};
	const unconditional: Tool = {
		spec: { name: "note", description: "从不要求停", parameters: {} },
		execute: () => ({ content: [{ type: "text", text: "记下了" }], details: "note", isError: false }),
	};
	const tools = [conditional, unconditional];

	/**
	 * 每次调用回**一整批**工具调用，而不是一步。
	 *
	 * `scriptedModel` 是「一次调用消耗一步」，用它根本造不出一批里有多条调用——
	 * 上面那两条对照会退化成两轮，而不是一批。要测 `every` 就得自己发批次。
	 * 批次跑完之后回一句纯文本：如果循环还活着，就会走到这里收尾。
	 */
	const batchModel =
		(batches: readonly (readonly Step[])[]): ModelFn =>
		() => {
			const batch = batches.shift();
			if (!batch) return { content: [{ type: "text", text: "（批次走完）" }], stopReason: "stop" };
			let index = 0;
			const content = batch.map((step) => {
				if (step.kind !== "call") throw new Error("批次里只能放工具调用");
				index += 1;
				return {
					type: "toolCall" as const,
					// 同一次响应里 id 必须互不相同——工具结果靠它配对。
					id: `call_${index}`,
					name: step.name,
					arguments: step.args,
				};
			});
			return { content, stopReason: "toolUse" };
		};

	/** 跑一批（或多批）。批与批之间，模型已经看过上一批的结果。 */
	const run = (...batches: readonly (readonly Step[])[]) =>
		runLoop({
			model: batchModel([...batches]),
			tools,
			context: emptyContext(),
		});

	const stopCall: Step = { kind: "call", name: "probe", args: { stop: true } };
	const continueCall: Step = { kind: "call", name: "probe", args: { stop: false } };
	const noteCall: Step = { kind: "call", name: "note", args: {} };

	// 一批里两条都要求停：停。模型没机会说那句话，上下文最后一条是工具结果。
	const allStop = run([stopCall, stopCall]);
	assert.equal(allStop.stopKind, "tools_terminated");
	assert.equal(allStop.messages[allStop.messages.length - 1]?.role, "toolResult");

	// 一批里一条要求停、一条不要求：**不停**。
	// 按 some 判这里就该停；pi 用的是 every（`agent-loop.ts:580-582`）。
	const mixed = run([stopCall, noteCall]);
	assert.equal(mixed.stopKind, "no_tool_calls");
	assert.equal(mixed.messages[mixed.messages.length - 1]?.role, "assistant");

	// 另一组「不一致」：两条命中**同一个**工具，只是参数不同，结论也不同。
	// 这正说明 terminate 挂在结果上，不是挂工具上的开关。
	assert.equal(run([stopCall, continueCall]).stopKind, "no_tool_calls");

	// 都不要求停：更不会停。
	assert.equal(run([noteCall, continueCall]).stopKind, "no_tool_calls");

	// 单独一条要求停：这一批「全部」（就一条）要求停，停。
	assert.equal(run([stopCall]).stopKind, "tools_terminated");

	// 分批到达也一样：第一批要求停，但循环已经在第一批就结束了，
	// 第二批永远轮不到——**停是当轮结算的，不会攒着。**
	const batched = run([stopCall], [noteCall]);
	assert.equal(batched.stopKind, "tools_terminated");
	assert.equal(batched.turns, 1);
});

test("shouldStopAfterTurn 在工具跑完之后被问一次", () => {
	const seen: number[] = [];
	const { result } = collect({
		model: scriptedModel([{ kind: "call", name: "list_dir", args: { path: "." } }, { kind: "say", text: "x" }]),
		tools: TOOLS,
		context: emptyContext(),
		shouldStopAfterTurn: ({ turn }) => {
			seen.push(turn);
			return true;
		},
	});

	assert.equal(result.stopKind, "host_stopped");
	assert.deepEqual(seen, [1]);
	assert.equal(result.turns, 1);
});

test("宿主在没有工具调用的那一轮也会被问，模型报错的那一轮不会", () => {
	const asked: number[] = [];
	const ask = ({ turn }: { turn: number }) => {
		asked.push(turn);
		return false;
	};

	runLoop({ model: scriptedModel([{ kind: "say", text: "x" }]), tools: TOOLS, context: emptyContext(), shouldStopAfterTurn: ask });
	// pi 的 252 行在内层每一轮末尾都执行，不管这一轮有没有工具调用。
	assert.deepEqual(asked, [1]);

	asked.length = 0;
	runLoop({ model: failingModel(0), tools: TOOLS, context: emptyContext(), shouldStopAfterTurn: ask });
	// 出错在 215-219 就 return 了，走不到 252。
	assert.deepEqual(asked, []);
});

test("工具真的读到了文件，且内容进了上下文", () => {
	const dir = mkdtempSync(join(tmpdir(), "ch01-loop-"));
	writeFileSync(join(dir, "hello.txt"), "第一行\n第二行\n", "utf8");

	const { result } = collect({
		model: scriptedModel([
			{ kind: "call", name: "read_file", args: { path: join(dir, "hello.txt") } },
			{ kind: "say", text: "读到了" },
		]),
		tools: TOOLS,
		context: emptyContext(),
	});

	const toolResult = result.messages.find((m) => m.role === "toolResult");
	assert.ok(toolResult);
	const text = toolResult.content.map((b) => (b.type === "text" ? b.text : "")).join("");
	assert.equal(text, "第一行\n第二行");
	assert.equal(toolResult.isError, false);
});

test("collectToolCalls 只挑工具调用块，忽略文字块", () => {
	const calls = collectToolCalls({
		role: "assistant",
		content: [
			{ type: "text", text: "我打算读一下这个文件" },
			{ type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "a.ts" } },
		],
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.name, "read_file");
});

test("toolResultMessage 带上配对用的 toolCallId", () => {
	const message = toolResultMessage(
		{ id: "call_7", name: "read_file", arguments: {} },
		{ content: [{ type: "text", text: "内容" }], details: "x", isError: false },
	);

	assert.equal(message.role, "toolResult");
	assert.equal(message.toolCallId, "call_7");
	assert.equal(message.toolName, "read_file");
});

test("默认不设上限时，剧本走完就自然收尾", () => {
	const { result } = collect({
		model: scriptedModel([{ kind: "call", name: "list_dir", args: { path: "." } }]),
		tools: TOOLS,
		context: emptyContext(),
	});

	// 剧本用完之后，scriptedModel 回一句「剧本已经走完」，于是正常收尾。
	assert.equal(result.stopKind, "no_tool_calls");
	assert.equal(result.turns, 2);
});

test("循环不修改传进来的 context 对象", () => {
	const context = emptyContext();
	const before = context.messages.length;
	collect({ model: scriptedModel([{ kind: "say", text: "x" }]), tools: TOOLS, context });
	assert.equal(context.messages.length, before);
	assert.deepEqual(context.messages, []);
});
