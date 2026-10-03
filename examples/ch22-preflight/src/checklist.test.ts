import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, exitCode, outOfBox, render, type Facts } from "./checklist.ts";

const ALL_ON: Facts = {
	loopGuard: { repeatBlock: true, turnCeiling: true },
	confirm: { toolCall: true, userBash: true, isolated: false },
	credentials: { bashTool: true, userBash: true },
	installScripts: { kind: "skipped", manager: "npm", via: "env" },
	crash: { runtime: "node", fallback: true },
};

const statusOf = (facts: Facts) => Object.fromEntries(evaluate(facts).map((item) => [item.name, item.status]));

test("开箱：四件必补全缺，Node 下崩溃收尾算一半", () => {
	const items = evaluate(outOfBox("node", { kind: "runs", manager: "npm" }));
	assert.deepEqual(statusOf(outOfBox("node", { kind: "runs", manager: "npm" })), {
		刹车: "missing",
		确认: "missing",
		凭据: "missing",
		安装脚本: "missing",
		崩溃收尾: "partial",
	});
	assert.equal(exitCode(items), 1);
});

test("Bun 二进制没有兜底：崩溃收尾算缺", () => {
	assert.equal(statusOf(outOfBox("bun", { kind: "runs", manager: "npm" }))["崩溃收尾"], "missing");
});

test("全补上退出码 0；建议项缺了不影响", () => {
	assert.equal(exitCode(evaluate(ALL_ON)), 0);
	assert.equal(exitCode(evaluate({ ...ALL_ON, crash: { runtime: "bun", fallback: false } })), 0);
});

test("只补一半算 partial，退出码 1", () => {
	const facts = { ...ALL_ON, confirm: { toolCall: true, userBash: false, isolated: false } };
	assert.equal(statusOf(facts)["确认"], "partial");
	assert.equal(exitCode(evaluate(facts)), 1);
});

test("安装脚本四种状态", () => {
	const of = (installScripts: Facts["installScripts"]) => statusOf({ ...ALL_ON, installScripts })["安装脚本"];
	assert.equal(of({ kind: "skipped", manager: "npm", via: "argv" }), "ok");
	assert.equal(of({ kind: "runs", manager: "npm" }), "missing");
	assert.equal(of({ kind: "manager-default", manager: "pnpm" }), "partial");
	assert.equal(of({ kind: "unknown", manager: "yarn" }), "partial");
});

test("确认的措辞：没有隔离时写明只是提醒", () => {
	const detail = (isolated: boolean) => evaluate({ ...ALL_ON, confirm: { ...ALL_ON.confirm, isolated } }).find((i) => i.name === "确认")?.detail ?? "";
	assert.match(detail(false), /不是边界/);
	assert.match(detail(true), /隔离/);
	assert.doesNotMatch(detail(true), /不是边界/);
});

test("render：没到位的才给补法", () => {
	const text = render(evaluate({ ...ALL_ON, credentials: { bashTool: true, userBash: false } }));
	assert.match(text, /✓ 必补  刹车/);
	assert.match(text, /△ 必补  凭据/);
	assert.equal(text.match(/→/g)?.length, 1);
	assert.match(text, /→ env-filter\.ts/);
});
