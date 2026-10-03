/**
 * 分层规则的测试。这一章的分层不是描述性的，是**可反驳的**：
 * 每个断言都在说「这个文件凭什么算那一层」。
 *
 * 这些用例刻意不只覆盖 pi 的真实路径——那只是样例。
 * 更要紧的是规则本身的边界：兜底项不能在前面、路径优先于内容、
 * 同一条规则不能既想吃 provider 又想兜产品层。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { LAYER_RULES, classifyFile, replacementCost, tallyLayers } from "./layers.ts";
import type { Layer, LayerTally } from "./layers.ts";

test("规则表的顺序是 provider → runtime → harness → product", () => {
	assert.deepEqual(
		LAYER_RULES.map((rule) => rule.layer),
		["provider", "runtime", "harness", "product"],
	);
	// 产品层是兜底：它在最后，因此永远是「其它都没命中」才轮到它。
	assert.equal(LAYER_RULES[LAYER_RULES.length - 1]?.layer, "product");
});

test("每条规则都写清楚了为什么，且至少有一个判据", () => {
	for (const rule of LAYER_RULES) {
		assert.ok(rule.why.length > 0, `${rule.layer} 缺 why`);
		assert.ok(rule.pathHits.length + rule.contentHits.length > 0, `${rule.layer} 没有任何判据`);
	}
});

test("pi 的真实文件各自落到该落的那一层", () => {
	// 这些路径都逐字来自 pi `b79e4cc8` 的源码树（packages/ 下）。
	const cases: readonly (readonly [string, Layer])[] = [
		["packages/ai/src/api/anthropic-messages.ts", "provider"],
		["packages/ai/src/api/openai-completions.ts", "provider"],
		["packages/ai/src/providers/anthropic.models.ts", "provider"],
		["packages/agent/src/agent-loop.ts", "runtime"],
		["packages/agent/src/agent.ts", "runtime"],
		["packages/agent/src/harness/agent-harness.ts", "harness"],
		["packages/coding-agent/src/core/tools/bash.ts", "harness"],
		["packages/coding-agent/src/core/system-prompt.ts", "harness"],
		["packages/coding-agent/src/core/session-manager.ts", "harness"],
		["packages/coding-agent/src/main.ts", "product"],
	];

	for (const [path, expected] of cases) {
		assert.equal(classifyFile(path).layer, expected, `${path} 应该算 ${expected}`);
	}
});

test("锚在路径段开头：名字里含 agent 的文件不会被误当成循环", () => {
	assert.notEqual(classifyFile("packages/agent/src/harness/agent-harness.ts").layer, "runtime");
	assert.notEqual(classifyFile("src/coding-agent.ts").layer, "runtime");
});

test("路径判据优先于内容判据", () => {
	// 路径说是 provider，内容里却全是循环的特征词——按规则应该听路径的。
	const content = "stopReason toolCall emit({ type: 'turn_start' })";
	const result = classifyFile("packages/ai/src/providers/anthropic-messages.ts", content);

	assert.equal(result.layer, "provider");
	assert.match(result.hits.join(""), /路径/);
});

test("路径没透露信息时，内容特征兜住它", () => {
	const result = classifyFile("src/whatever.ts", "const stopReason = reply.stopReason;");

	assert.equal(result.layer, "runtime");
	assert.match(result.hits.join(""), /内容/);
});

test("四条都不命中时落到产品层，并且明说这是兜底", () => {
	const result = classifyFile("src/zzz.ts", "const a = 1;");

	assert.equal(result.layer, "product");
	assert.match(result.hits.join(""), /兜底/);
});

test("hits 会说出命中的是哪条规则——这就是「可反驳」的样子", () => {
	const result = classifyFile("packages/agent/src/agent-loop.ts");

	assert.equal(result.layer, "runtime");
	assert.equal(result.hits.length, 1);
	// 断言的是形状：里面有正则源码，别人照着能自己复算一遍。
	assert.match(result.hits[0] ?? "", /agent-loop/);
});

test("tallyLayers 覆盖四层，没命中的层补零而不是缺席", () => {
	const tally = tallyLayers([["packages/agent/src/agent-loop.ts", 794]]);

	assert.equal(tally.length, 4);
	assert.deepEqual(
		tally.map((t) => t.layer),
		["provider", "runtime", "harness", "product"],
	);
	assert.equal(tally.find((t) => t.layer === "runtime")?.lines, 794);
	assert.equal(tally.find((t) => t.layer === "provider")?.files, 0);
});

test("tallyLayers 不改动传入的数组", () => {
	const entries: [string, number][] = [["packages/agent/src/agent-loop.ts", 10]];
	const copy = [...entries];

	tallyLayers(entries);

	assert.deepEqual(entries, copy);
});

test("replacementCost 按行数占比排序，最大的排最前", () => {
	const tally: readonly LayerTally[] = [
		{ layer: "provider", files: 1, lines: 100 },
		{ layer: "runtime", files: 1, lines: 300 },
		{ layer: "harness", files: 1, lines: 600 },
		{ layer: "product", files: 0, lines: 0 },
	];

	const summary = replacementCost(tally);

	assert.match(summary, /^1000 行/);
	// harness 600 行占 60%，必须排在 runtime 前面。
	assert.ok(summary.indexOf("harness 60.0%") < summary.indexOf("runtime 30.0%"));
	// 零行的层不进占比串——列出来只会稀释信息。
	assert.ok(!summary.includes("product"));
});

test("replacementCost 面对空输入时给一句话，不是 NaN", () => {
	const summary = replacementCost([
		{ layer: "provider", files: 0, lines: 0 },
		{ layer: "runtime", files: 0, lines: 0 },
		{ layer: "harness", files: 0, lines: 0 },
		{ layer: "product", files: 0, lines: 0 },
	]);

	assert.equal(summary, "没有可统计的源码行。");
});
