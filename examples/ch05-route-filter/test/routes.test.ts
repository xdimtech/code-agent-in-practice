import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DOCS } from "../src/evidence.ts";
import { RULES } from "../src/questions.ts";
import { ROUTES, routeOf } from "../src/routes.ts";
import type { Evidence } from "../src/types.ts";
import { DIMENSIONS, ROUTE_IDS } from "../src/types.ts";

function allEvidence(): readonly Evidence[] {
	return [
		...ROUTES.flatMap((route) => [
			...DIMENSIONS.flatMap((dimension) => route.facts[dimension.id].evidence),
			...route.ownership.flatMap((fact) => fact.evidence),
		]),
		...RULES.flatMap((rule) => rule.evidence),
	];
}

test("ROUTES 的顺序就是 ROUTE_IDS 的顺序，routeOf 取得到每一条", () => {
	assert.deepEqual(
		ROUTES.map((route) => route.id),
		[...ROUTE_IDS],
	);
	for (const id of ROUTE_IDS) assert.equal(routeOf(id).id, id);
});

test("每条路线的八个维度都有陈述，而且每条陈述都有出处", () => {
	for (const route of ROUTES) {
		for (const dimension of DIMENSIONS) {
			const fact = route.facts[dimension.id];
			assert.ok(fact.text.trim().length > 0, `${route.id} / ${dimension.id} 没有陈述`);
			assert.ok(fact.evidence.length > 0, `${route.id} / ${dimension.id} 没有出处`);
		}
	}
});

test("每条路线都至少有一件「自己扛的事」，而且有出处", () => {
	for (const route of ROUTES) {
		assert.ok(route.ownership.length > 0, `${route.id} 没有 ownership`);
		for (const fact of route.ownership) assert.ok(fact.evidence.length > 0, `${route.id}：「${fact.text}」没有出处`);
	}
});

test("Claude Agent SDK 一列只引公开文档：不出现任何 code 出处", () => {
	const sdk = routeOf("agent-sdk");
	const evidence = [
		...DIMENSIONS.flatMap((dimension) => sdk.facts[dimension.id].evidence),
		...sdk.ownership.flatMap((fact) => fact.evidence),
		...RULES.filter((rule) => rule.route === "agent-sdk").flatMap((rule) => rule.evidence),
	];
	assert.ok(evidence.length > 0);
	for (const item of evidence) assert.equal(item.kind, "doc", JSON.stringify(item));
});

test("文档出处只用 DOCS 里登记过的地址，方便统一换抓取日期", () => {
	const known = new Set<string>(Object.values(DOCS));
	for (const item of allEvidence()) {
		if (item.kind === "doc") assert.ok(known.has(item.url), item.url);
	}
});

test("code 出处的路径是仓库内的相对路径", () => {
	for (const item of allEvidence()) {
		if (item.kind !== "code") continue;
		assert.ok(!item.path.startsWith("/"), item.path);
		assert.ok(!item.path.split("/").includes(".."), item.path);
	}
});

test("没有引用不公开的内部版本：只引开源的 Step-Code", () => {
	const text = JSON.stringify({ ROUTES, RULES });
	assert.ok(!/step.harness/i.test(text));
});
