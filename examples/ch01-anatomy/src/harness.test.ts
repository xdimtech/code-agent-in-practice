/**
 * harness 的测试。这一层不产生新的行为，它**接线**——所以断言的都是
 * 「接对了没有」：给的工具有没有照着场景摘、用户消息有没有先落上下文、
 * 会话记录重放出来跟内存里的上下文是不是同一份。
 *
 * 最后那条是这份文件里最值钱的断言。它一旦不成立，
 * 「恢复会话」就是坏的，而坏的恢复不会报错——它只会让模型看到一段
 * 缺了工具结果的历史（第 14 章）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildPrompt,
	describeContext,
	memorySessionStore,
	resumeContext,
	runWithHarness,
	selectTools,
	toolSnippets,
} from "./harness.ts";
import { scriptedModel } from "./model.ts";
import type { Step } from "./model.ts";
import { createListDirTool, createReadFileTool, createWriteFileTool } from "./tools.ts";
import type { Context, Message, Tool } from "./types.ts";

const ALL_TOOLS: readonly Tool[] = [createReadFileTool(), createListDirTool(), createWriteFileTool()];

const FIXED_TIME = "1970-01-01T00:00:00.000Z";

// ── 1. 工具集：有哪些 ≠ 这次给哪些 ──────────────────────────────────────

test("selectTools 默认原样给全部", () => {
	const selection = selectTools(ALL_TOOLS);

	assert.equal(selection.active.length, 3);
	assert.equal(selection.excluded.length, 0);
});

test("selectTools 在只读模式下摘掉写工具，并说清为什么", () => {
	const selection = selectTools(ALL_TOOLS, { readOnly: true });

	assert.deepEqual(
		selection.active.map((t) => t.spec.name),
		["read_file", "list_dir"],
	);
	assert.equal(selection.excluded.length, 1);
	assert.equal(selection.excluded[0]?.name, "write_file");
	// 理由要能被打印出来——不然用户只会看到「少了个工具」。
	assert.match(selection.excluded[0]?.reason ?? "", /只读/);
});

test("selectTools 的 exclude 名单优先于只读模式", () => {
	// 已经因为只读被摘掉的工具，不该在排除名单里再出现一次。
	const selection = selectTools(ALL_TOOLS, { readOnly: true, exclude: ["list_dir", "write_file"] });

	assert.deepEqual(
		selection.active.map((t) => t.spec.name),
		["read_file"],
	);
	assert.equal(selection.excluded.length, 2);
});

test("selectTools 不修改传进来的工具数组", () => {
	const tools = [...ALL_TOOLS];
	const copy = tools.map((t) => t.spec.name);

	selectTools(tools, { readOnly: true });

	assert.deepEqual(
		tools.map((t) => t.spec.name),
		copy,
	);
});

// ── 2. 系统提示词 ───────────────────────────────────────────────────────

test("buildPrompt 只有基座时不做多余包装", () => {
	assert.equal(buildPrompt({ base: "你是一个助手。" }), "你是一个助手。");
});

test("buildPrompt 把项目说明包进 project_instructions，带上路径", () => {
	const prompt = buildPrompt({
		base: "基座",
		projectContext: [{ path: "/repo/AGENTS.md", content: "本项目用 tab 缩进。" }],
	});

	assert.match(prompt, /<project_instructions path="\/repo\/AGENTS\.md">/);
	assert.match(prompt, /本项目用 tab 缩进。/);
	assert.match(prompt, /<\/project_instructions>/);
	// 项目说明是拼进提示词的，不是当成消息——它属于「每次请求都一样」的那部分。
	assert.ok(prompt.startsWith("基座"));
});

test("buildPrompt 里项目说明在追加段之前", () => {
	const prompt = buildPrompt({
		base: "基座",
		projectContext: [{ path: "AGENTS.md", content: "项目说明" }],
		appended: "扩展追加",
	});

	assert.ok(prompt.indexOf("项目说明") < prompt.indexOf("扩展追加"));
	assert.ok(prompt.endsWith("扩展追加"));
});

test("buildPrompt 面对空的项目说明列表时不加空壳", () => {
	const prompt = buildPrompt({ base: "基座", projectContext: [] });

	assert.equal(prompt, "基座");
	assert.ok(!prompt.includes("project_context"));
});

test("toolSnippets 只给名字和一句话，不给整个 schema", () => {
	const snippets = toolSnippets(ALL_TOOLS);

	assert.match(snippets, /^- read_file: /m);
	assert.match(snippets, /^- list_dir: /m);
	// 三行，一行一个工具。
	assert.equal(snippets.split("\n").length, 3);
});

// ── 3. 会话记录 ─────────────────────────────────────────────────────────

test("会话的第一条记录必须是 session，否则抛出", () => {
	const store = memorySessionStore(".", () => FIXED_TIME);
	const message: Message = { role: "user", content: [{ type: "text", text: "你好" }] };

	// 静默接受会让「打不开的会话文件」变成运行时才发现的问题。
	assert.throws(() => store.append({ kind: "message", message }), /第一条记录必须是 session/);
});

test("第一条是 session 之后就正常追加", () => {
	const store = memorySessionStore(".", () => FIXED_TIME);
	store.append({ kind: "session", cwd: ".", startedAt: FIXED_TIME });
	store.append({ kind: "message", message: { role: "user", content: [{ type: "text", text: "你好" }] } });

	assert.equal(store.records.length, 2);
});

test("resumeContext 只重放 message 记录，跳过 session 和 stop", () => {
	const store = memorySessionStore(".", () => FIXED_TIME);
	store.append({ kind: "session", cwd: ".", startedAt: FIXED_TIME });
	store.append({ kind: "message", message: { role: "user", content: [{ type: "text", text: "你好" }] } });
	store.append({ kind: "stop", stopKind: "no_tool_calls", turns: 1 });

	const context = resumeContext(store, "系统提示词", ALL_TOOLS);

	assert.equal(context.messages.length, 1);
	assert.equal(context.messages[0]?.role, "user");
	assert.equal(context.systemPrompt, "系统提示词");
	assert.deepEqual(
		context.tools.map((t) => t.name),
		["read_file", "list_dir", "write_file"],
	);
});

// ── 4. 组装 ─────────────────────────────────────────────────────────────

function runOnce(options: { readonly readOnly?: boolean; readonly steps: readonly Step[] }) {
	const session = memorySessionStore(".", () => FIXED_TIME);
	const run = runWithHarness({
		cwd: ".",
		model: scriptedModel(options.steps),
		allTools: ALL_TOOLS,
		prompt: { base: "基座" },
		session,
		now: () => FIXED_TIME,
		userMessage: "看一下这里有什么。",
		readOnly: options.readOnly,
	});
	return { session, run };
}

test("runWithHarness 把用户消息放进上下文的第一条", () => {
	const { run } = runOnce({ steps: [{ kind: "say", text: "好的" }] });

	assert.equal(run.context.messages[0]?.role, "user");
	assert.equal(
		run.context.messages[0]?.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
		"看一下这里有什么。",
	);
});

test("runWithHarness 只把本次给的工具写进上下文", () => {
	const { run } = runOnce({ readOnly: true, steps: [{ kind: "say", text: "好的" }] });

	assert.deepEqual(
		run.context.tools.map((t) => t.name),
		["read_file", "list_dir"],
	);
	// 系统提示词里列出的工具集必须和实际给的一致——两边不一致，
	// 模型会去调一个它其实没法调的工具。
	assert.match(run.systemPrompt, /list_dir/);
	assert.ok(!run.systemPrompt.includes("write_file"));
});

test("runWithHarness 的系统提示词里有可用工具清单", () => {
	const { run } = runOnce({ steps: [{ kind: "say", text: "好的" }] });

	assert.match(run.systemPrompt, /可用工具：/);
	assert.match(run.systemPrompt, /read_file/);
});

test("会话记录重放出来跟内存里的上下文一模一样", () => {
	// 这次必须真的跑工具：工具结果也走 message_end 是重放能对上的前提。
	// 少了它，重放出来的历史会比内存里短，而且不报错（1.4 节）。
	const { session, run } = runOnce({
		steps: [
			{ kind: "call", name: "list_dir", args: { path: "." } },
			{ kind: "say", text: "看完了" },
		],
	});

	const resumed = resumeContext(session, run.systemPrompt, run.selection.active);

	assert.deepEqual(
		resumed.messages.map((m) => m.role),
		run.context.messages.map((m) => m.role),
	);
	assert.equal(resumed.messages.length, run.context.messages.length);
	// 顺序也要对得上，不只是条数。
	assert.deepEqual(resumed.messages, run.context.messages);
});

test("会话记录里第一条是 session，最后一条是 stop", () => {
	const { session, run } = runOnce({ steps: [{ kind: "say", text: "好的" }] });
	const records = session.records;

	assert.equal(records[0]?.kind, "session");
	assert.equal(records[records.length - 1]?.kind, "stop");
	const last = records[records.length - 1];
	assert.equal(last?.kind === "stop" ? last.stopKind : "", run.result.stopKind);
});

test("用户消息只被记一次，不因为经过事件又记一遍", () => {
	const { session } = runOnce({ steps: [{ kind: "say", text: "好的" }] });

	const userRecords = session.records.filter(
		(record) =>
			record.kind === "message" &&
			record.message.role === "user" &&
			record.message.content.some((b) => b.type === "text" && b.text === "看一下这里有什么。"),
	);

	assert.equal(userRecords.length, 1);
});

test("describeContext 摊开上下文时标出每条消息有哪些内容块", () => {
	const context: Context = {
		systemPrompt: "四个字符",
		tools: ALL_TOOLS.map((t) => t.spec),
		messages: [
			{ role: "user", content: [{ type: "text", text: "你好" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "我看看" },
					{ type: "toolCall", id: "call_1", name: "list_dir", arguments: {} },
				],
			},
		],
	};

	const text = describeContext(context);

	assert.match(text, /systemPrompt：4 字符/);
	assert.match(text, /messages：2 条/);
	// 一条消息里既有文字又有工具调用时，两个块都要列出来。
	assert.match(text, /assistant \(text\+toolCall\)/);
});

test("describeContext 在没有工具时也说「无」，不是空白", () => {
	const text = describeContext({ systemPrompt: "", tools: [], messages: [] });

	assert.match(text, /tools：（无）/);
});
