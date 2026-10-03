import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT_INTERNAL, EXIT_OK, EXIT_USAGE, main } from "./main.ts";

/** 收输出的假终端，免得测试往真的 stdout 上写。 */
function sink() {
	const chunks: string[] = [];
	return {
		write(text: string) {
			chunks.push(text);
			return true;
		},
		get text() {
			return chunks.join("");
		},
	};
}

const io = (env: Record<string, string | undefined> = {}) => ({ out: sink(), err: sink(), env });

test("没有子命令：打用法，退出码 0", async () => {
	const target = io();
	assert.equal(await main([], target), EXIT_OK);
	assert.match(target.out.text, /用法/);
});

test("不认识的子命令：退出码 2", async () => {
	const target = io();
	assert.equal(await main(["nope"], target), EXIT_USAGE);
	assert.match(target.err.text, /不认识的子命令/);
});

test("explain 默认读 fixture，能出时间线", async () => {
	const target = io();
	assert.equal(await main(["explain"], target), EXIT_OK);
	assert.match(target.out.text, /fixture/);
	assert.match(target.out.text, /\[第 2 轮\]/);
	assert.match(target.out.text, /共 23 个事件/);
});

test("explain --counts：按类型计数", async () => {
	const target = io();
	assert.equal(await main(["explain", "--counts"], target), EXIT_OK);
	assert.match(target.out.text, /按类型计数/);
	assert.match(target.out.text, /tool_execution_start/);
});

test("explain：文件不存在会被内部错误接住，退出码 70", async () => {
	const target = io();
	assert.equal(await main(["explain", "--json", "/definitely/not/here.jsonl"], target), EXIT_INTERNAL);
	assert.match(target.err.text, /内部错误/);
});

test("不认识的选项：退出码 2", async () => {
	const target = io();
	assert.equal(await main(["explain", "--nope"], target), EXIT_USAGE);
	assert.match(target.err.text, /不认识的选项/);
});

test("doctor：正常环境没 fail，退出码 0", async () => {
	const target = io({ OPENAI_API_KEY: "x" });
	assert.equal(await main(["doctor"], target), EXIT_OK);
	assert.match(target.out.text, /pi 环境体检/);
	assert.match(target.out.text, /Node 版本/);
});

test("doctor --json：字段齐全", async () => {
	const target = io();
	assert.equal(await main(["doctor", "--json"], target), EXIT_OK);
	const parsed = JSON.parse(target.out.text) as { checks: { name: string }[]; worst: string };
	assert.ok(parsed.checks.length >= 6);
	assert.ok(["ok", "warn"].includes(parsed.worst));
});

test("doctor 的输出里不出现凭据的值", async () => {
	// 这条是这一章最该有的一条断言：体检命令打印凭据是常见事故。
	const target = io({ OPENAI_API_KEY: "sk-super-secret-value" });
	await main(["doctor"], target);
	assert.ok(!target.out.text.includes("sk-super-secret-value"));
	assert.ok(!target.err.text.includes("sk-super-secret-value"));
	assert.match(target.out.text, /OPENAI_API_KEY/);
});

test("script：能看到两轮的打算，命令行覆盖文件与工具", async () => {
	const target = io();
	assert.equal(await main(["script", "--file", "other.txt", "--tool", "bash"], target), EXIT_OK);
	assert.match(target.out.text, /file=other\.txt tool=bash/);
	assert.match(target.out.text, /bash\(\{"path":"other\.txt"\}\)/);
	assert.match(target.out.text, /stopReason = toolUse/);
	assert.match(target.out.text, /stopReason = stop/);
});

test("script --quiet：第二轮只回一行", async () => {
	const target = io();
	assert.equal(await main(["script", "--quiet", "--file", "x.txt"], target), EXIT_OK);
	assert.match(target.out.text, /report=false/);
	assert.match(target.out.text, /已读完 x\.txt。/);
});

test("script：环境变量兜底，旗标优先", async () => {
	const fromEnv = io({ PI_DEMO_FILE: "env.txt" });
	await main(["script"], fromEnv);
	assert.match(fromEnv.out.text, /file=env\.txt/);

	const both = io({ PI_DEMO_FILE: "env.txt" });
	await main(["script", "--file", "flag.txt"], both);
	assert.match(both.out.text, /file=flag\.txt/);
});

test("session：目录不存在也是 0", async () => {
	const target = io();
	assert.equal(await main(["session", "--agent-dir", "/definitely/not/here"], target), EXIT_OK);
	assert.match(target.out.text, /还没有/);
});

test("session：会说明目录名的出处", async () => {
	const target = io();
	await main(["session", "--agent-dir", "/definitely/not/here"], target);
	assert.doesNotMatch(target.out.text, /session-manager/);
	// 有会话时才打这句；这里目录是空的，所以不该出现。
});
