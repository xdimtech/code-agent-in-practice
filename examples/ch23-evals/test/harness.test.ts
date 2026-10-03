import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { runInWorkspace, runScript } from "../src/harness.ts";
import type { Harness, Tool, ToolContext } from "../src/harness.ts";
import { baselineHarness, candidateHarness } from "../src/tools.ts";
import type { AgentEvent } from "../src/types.ts";

function context(overrides: Partial<ToolContext> = {}): ToolContext {
	return { cwd: "/tmp/ch23-fake/work", root: "/tmp/ch23-fake", ...overrides };
}

const echo: Tool = {
	name: "echo",
	run(args) {
		return typeof args.text === "string" ? { ok: true } : { ok: false, error: "缺少 text" };
	},
};

const failing: Tool = {
	name: "boom",
	run() {
		return { ok: false, error: "炸了" };
	},
};

const harness: Harness = { name: "test-harness", tools: [echo, failing] };

test("脚本按顺序跑，事件是 tool_call 接 tool_result", () => {
	const outcome = runScript(harness, ['tool: echo {"text": "hi"}'], context());
	assert.deepEqual(
		outcome.events.map((event) => event.type),
		["tool_call", "tool_result", "response"],
	);
	assert.equal(outcome.toolCalls, 1);
});

test("一个回合里，工具行之外的文本拼成回复正文", () => {
	const outcome = runScript(harness, ['第一行\ntool: echo {"text": "hi"}\n第二行'], context());
	assert.equal(outcome.output, "第一行\n第二行");
});

test("多个回合：最后的正文是输出，中间回合的正文留在事件里", () => {
	const outcome = runScript(harness, ['tool: echo {"text": "a"}', "都做完了。"], context());
	assert.equal(outcome.output, "都做完了。");
	const responses = outcome.events.filter((event) => event.type === "response");
	assert.equal(responses.length, 2);
});

test("工具失败就中断脚本，回一句带原因的失败", () => {
	const script = ['tool: boom {}', 'tool: echo {"text": "这句不该跑到"}'];
	const outcome = runScript(harness, script, context());
	assert.equal(outcome.toolCalls, 1);
	assert.equal(outcome.output, "没能完成：boom 失败：炸了");
	const errors = outcome.events.filter((event): event is Extract<AgentEvent, { type: "error" }> => event.type === "error");
	assert.equal(errors.length, 1);
});

test("脚本写了不存在的工具：抛异常，因为那是脚本自己的 bug", () => {
	assert.throws(() => runScript(harness, ['tool: nope {}'], context()), /没有名为 nope 的工具/);
});

test("工具参数必须是合法 JSON 对象，写错了抛出来", () => {
	assert.throws(() => runScript(harness, ["tool: echo {不是 JSON}"], context()), /不是 JSON/);
	assert.throws(() => runScript(harness, ['tool: echo ["数组不行"]'], context()), /必须是对象/);
});

test("没有参数的调用写成光名字也能跑", () => {
	const outcome = runScript(harness, ["tool: boom"], context());
	assert.equal(outcome.toolCalls, 1);
	assert.equal(outcome.output, "没能完成：boom 失败：炸了");
});

test("空脚本：一次调用都没有，输出是空串", () => {
	const outcome = runScript(harness, [], context());
	assert.equal(outcome.toolCalls, 0);
	assert.equal(outcome.output, "");
	assert.deepEqual(outcome.events, []);
});

test("每条运行都在自己的沙箱里，跑完就删", () => {
	let observed = "";
	const result = runInWorkspace(baselineHarness, {
		script: ['tool: write_file {"path": "a.txt", "content": "x"}'],
		inspect: (context) => {
			observed = context.cwd;
			return { seen: existsSync(join(context.cwd, "a.txt")) };
		},
	});
	assert.equal(result.artifacts.seen, true);
	assert.equal(existsSync(observed), false, "跑完沙箱应该已经删了");
});

test("两次运行的临时目录不一样：cwd 带随机后缀，所以轨迹必须归一化", () => {
	const cwds: string[] = [];
	for (let index = 0; index < 2; index += 1) {
		runInWorkspace(baselineHarness, {
			script: [],
			inspect: (context) => {
				cwds.push(context.cwd);
				return {};
			},
		});
	}
	assert.notEqual(cwds[0], cwds[1]);
});

test("prepare 在跑脚本之前执行，用来布置初始现场", () => {
	const prepared: Harness = {
		name: "prepared",
		tools: [echo],
		prepare(context) {
			mkdirSync(context.cwd, { recursive: true });
			writeFileSync(join(context.cwd, "package.json"), "{}", "utf8");
		},
	};
	const result = runInWorkspace(prepared, {
		script: [],
		inspect: (context) => ({ hasPackage: existsSync(join(context.cwd, "package.json")) }),
	});
	assert.equal(result.artifacts.hasPackage, true);
});

test("usage 记下方案名和工具调用次数，用量字段留给调用方", () => {
	const result = runInWorkspace(candidateHarness, { script: ['tool: list_files {"path": "."}'], usage: { totalMs: 12 } });
	assert.equal(result.usage.provider, "scripted");
	assert.equal(result.usage.model, candidateHarness.name);
	assert.equal(result.usage.toolCalls, 1);
	assert.equal(result.usage.totalMs, 12);
});

test("工具参数是拷贝出去的：改事件里的 args 不影响后续断言用的数据源", () => {
	const result = runInWorkspace(baselineHarness, { script: ['tool: write_file {"path": "a.txt", "content": "x"}'] });
	const call = result.events.find((event) => event.type === "tool_call");
	assert.ok(call);
	assert.deepEqual(call.type === "tool_call" ? call.args : {}, { path: "a.txt", content: "x" });
});
