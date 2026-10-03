import { strict as assert } from "node:assert";
import { test } from "node:test";

import { filterRoutes, ruleMatches, validateAnswers } from "../src/filter.ts";
import { QUESTIONS, RULES, questionOf } from "../src/questions.ts";
import { routeOf } from "../src/routes.ts";
import type { Answers, RouteId, Verdict } from "../src/types.ts";
import { ROUTE_IDS } from "../src/types.ts";

function verdictOf(verdicts: readonly Verdict[], id: RouteId): Verdict {
	const found = verdicts.find((verdict) => verdict.route.id === id);
	assert.ok(found, id);
	return found;
}

function excluded(answers: Answers): readonly RouteId[] {
	return filterRoutes(answers)
		.filter((verdict) => verdict.status === "excluded")
		.map((verdict) => verdict.route.id);
}

test("什么都不回答：四条都留下，义务只有路线自带的那些", () => {
	const verdicts = filterRoutes({});
	assert.deepEqual(
		verdicts.map((verdict) => verdict.status),
		["viable", "viable", "viable", "viable"],
	);
	for (const verdict of verdicts) {
		assert.equal(verdict.obligations.length, routeOf(verdict.route.id).ownership.length);
		assert.ok(verdict.obligations.every((finding) => finding.questions.length === 0));
	}
});

test("输出顺序固定，和回答无关——不偷偷排名次", () => {
	const answerSets: readonly Answers[] = [
		{},
		{ models: "mixed", approval: "yes" },
		{ models: "openai", upstream: "yes", license: "yes", loop: "yes" },
	];
	for (const answers of answerSets) {
		assert.deepEqual(
			filterRoutes(answers).map((verdict) => verdict.route.id),
			[...ROUTE_IDS],
		);
	}
});

test("validateAnswers：拼错的问题、拼错的值都直接报错，不当作没回答", () => {
	assert.throws(() => validateAnswers({ model: "claude" }), /没有这个问题：--model/);
	assert.throws(() => validateAnswers({ models: "gpt" }), /--models 的值只能是 claude \/ openai \/ mixed/);
	assert.throws(() => validateAnswers({ models: "toString" }), /只能是/);
	assert.deepEqual(validateAnswers({ models: "claude", host: "node" }), { models: "claude", host: "node" });
});

test("混用模型：排除 Agent SDK，给 fork codex 和直连 API 各加一项义务", () => {
	const verdicts = filterRoutes({ models: "mixed" });
	assert.equal(verdictOf(verdicts, "agent-sdk").status, "excluded");
	for (const id of ["fork-codex", "direct-api"] as const) {
		const verdict = verdictOf(verdicts, id);
		assert.equal(verdict.status, "viable");
		assert.ok(verdict.obligations.some((finding) => finding.questions.includes("models")), id);
	}
	assert.equal(verdictOf(verdicts, "pi").obligations.filter((finding) => finding.questions.includes("models")).length, 0);
});

test("只用 Claude：Agent SDK 留下，fork codex 要自己补协议转换", () => {
	const verdicts = filterRoutes({ models: "claude" });
	assert.equal(verdictOf(verdicts, "agent-sdk").status, "viable");
	assert.ok(verdictOf(verdicts, "fork-codex").obligations.some((finding) => finding.reason.includes("Responses")));
});

test("「且」规则：Python 宿主本身只给 pi 加义务；再加上不接受子进程才排除", () => {
	assert.ok(!excluded({ host: "python" }).includes("pi"));
	assert.ok(verdictOf(filterRoutes({ host: "python" }), "pi").obligations.some((finding) => finding.questions.includes("host")));
	assert.ok(!excluded({ "session-process": "no" }).includes("pi"));
	assert.ok(!excluded({ host: "node", "session-process": "no" }).includes("pi"));
	assert.ok(excluded({ host: "python", "session-process": "no" }).includes("pi"));
});

test("不接受每会话一个子进程：Agent SDK 和 fork codex 被排除", () => {
	assert.deepEqual(excluded({ "session-process": "no" }), ["agent-sdk", "fork-codex"]);
});

test("第一天就要现成审批：直连 API 和 pi 被排除，排除理由带出处", () => {
	const verdicts = filterRoutes({ approval: "yes" });
	assert.deepEqual(excluded({ approval: "yes" }), ["direct-api", "pi"]);
	for (const id of ["direct-api", "pi"] as const) {
		for (const finding of verdictOf(verdicts, id).exclusions) assert.ok(finding.evidence.length > 0);
	}
});

test("要 harness 自带沙箱：Agent SDK 留下但要自己打开、套容器", () => {
	const verdicts = filterRoutes({ sandbox: "yes" });
	assert.deepEqual(excluded({ sandbox: "yes" }), ["direct-api", "pi"]);
	assert.ok(verdictOf(verdicts, "agent-sdk").obligations.some((finding) => finding.questions.includes("sandbox")));
	assert.equal(verdictOf(verdicts, "fork-codex").obligations.filter((finding) => finding.questions.includes("sandbox")).length, 0);
});

test("要改循环 + 修复必须回上游：剩下直连 API 和 pi", () => {
	assert.deepEqual(excluded({ loop: "yes", upstream: "yes" }), ["agent-sdk", "fork-codex"]);
});

test("约束互相冲突时四条都会被排除，这也是一个有用的答案", () => {
	const answers: Answers = { models: "mixed", approval: "yes", upstream: "yes" };
	assert.deepEqual(excluded(answers), [...ROUTE_IDS]);
});

test("一条路线被排除时，义务照样列出来，方便看「如果让步要扛什么」", () => {
	const pi = verdictOf(filterRoutes({ approval: "yes", license: "yes" }), "pi");
	assert.equal(pi.status, "excluded");
	assert.ok(pi.obligations.some((finding) => finding.questions.includes("license")));
});

test("ruleMatches：没回答的问题不匹配；空条件的规则是数据错误", () => {
	const rule = RULES.find((item) => item.route === "pi" && Object.keys(item.when).length === 2);
	assert.ok(rule);
	assert.equal(ruleMatches(rule, {}), false);
	assert.equal(ruleMatches(rule, { host: "python" }), false);
	assert.equal(ruleMatches(rule, { host: "python", "session-process": "no" }), true);
	assert.throws(() => ruleMatches({ ...rule, when: {} }, {}), /规则没有条件/);
});

test("规则数据自洽：问题和选项都存在，理由和出处都不空", () => {
	for (const rule of RULES) {
		assert.ok(rule.reason.trim().length > 0);
		assert.ok(rule.evidence.length > 0, rule.reason);
		for (const [question, values] of Object.entries(rule.when)) {
			const options = questionOf(question as never).options;
			for (const value of values ?? []) assert.ok(Object.hasOwn(options, value), `${question}=${value}`);
		}
	}
});

test("每个问题至少驱动一条规则——问了却不影响结果的问题不该出现", () => {
	for (const question of QUESTIONS) {
		assert.ok(
			RULES.some((rule) => Object.hasOwn(rule.when, question.id)),
			question.id,
		);
	}
	assert.throws(() => questionOf("nope" as never), /没有这个问题/);
});

test("filterRoutes 不改动传进来的回答", () => {
	const answers = Object.freeze({ models: "mixed", host: "python" });
	filterRoutes(answers);
	assert.deepEqual(answers, { models: "mixed", host: "python" });
});
