import assert from "node:assert/strict";
import { test } from "node:test";
import { describeContext, planNextTurn, stopReasonFor } from "./script.ts";
import type { Context, Message } from "./types.ts";

const user: Message = { role: "user", content: [{ type: "text", text: "读一下 hello.txt" }] };
const toolUse: Message = {
	role: "assistant",
	content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "hello.txt" } }],
	stopReason: "toolUse",
};
const toolResult: Message = {
	role: "toolResult",
	toolCallId: "call_1",
	toolName: "read",
	content: [{ type: "text", text: "hello from hello.txt" }],
	isError: false,
};

test("第一轮：还没有工具结果，就调工具", () => {
	const plan = planNextTurn({ messages: [user] });
	assert.equal(plan.kind, "toolCall");
	assert.deepEqual(plan, { kind: "toolCall", id: "call_1", name: "read", args: { path: "hello.txt" } });
	assert.equal(stopReasonFor(plan), "toolUse");
});

test("第二轮：已经有工具结果，就用文字收尾", () => {
	const plan = planNextTurn({ messages: [user, toolUse, toolResult] });
	assert.equal(plan.kind, "text");
	assert.equal(stopReasonFor(plan), "stop");
});

test("文件与工具可以换", () => {
	const plan = planNextTurn({ messages: [user] }, { file: "other.txt", tool: "bash" });
	assert.deepEqual(plan, { kind: "toolCall", id: "call_1", name: "bash", args: { path: "other.txt" } });
});

test("报告模式：把上下文摊开，含 system prompt 长度、工具名、每条消息", () => {
	const context: Context = {
		systemPrompt: "x".repeat(100),
		tools: [{ name: "read" }, { name: "bash" }],
		messages: [user, toolUse, toolResult],
	};
	const text = describeContext(context, "hello.txt");
	assert.match(text, /收到第 3 条消息/);
	assert.match(text, /system prompt：100 个字符/);
	assert.match(text, /可用工具：read, bash/);
	// 从 0 开始编号：0 是用户，1 是刚才那次工具调用，2 是工具结果。
	// assistant 那条只有 toolCall 块、没有文本块，所以 textOf 是空串。
	assert.match(text, /1\. assistant：""/);
	assert.match(text, /2\. toolResult（read）：1 行，第一行是 "hello from hello\.txt"/);
	assert.match(text, /hello\.txt 的内容已经作为一条 toolResult 消息回到了上下文里/);
});

test("报告模式：工具出错会标出来；没有工具就写（没有）", () => {
	const failed: Message = { ...toolResult, isError: true, content: [{ type: "text", text: "ENOENT: no such file" }] };
	const text = describeContext({ messages: [user, failed] }, "hello.txt");
	assert.match(text, /toolResult（read，出错）/);
	assert.match(describeContext({ messages: [user] }, "hello.txt"), /可用工具：（没有）/);
});

test("安静模式：只回一行，不摊开", () => {
	const plan = planNextTurn({ messages: [user, toolResult] }, { report: false, file: "other.txt" });
	assert.deepEqual(plan, { kind: "text", text: "已读完 other.txt。" });
});

test("空上下文也算第一轮，照样调工具", () => {
	assert.equal(planNextTurn({ messages: [] }).kind, "toolCall");
});

test("多行工具结果：行数按真实行数算", () => {
	const multi: Message = { ...toolResult, content: [{ type: "text", text: "a\nb\nc" }] };
	assert.match(describeContext({ messages: [multi] }, "x"), /：3 行/);
});
