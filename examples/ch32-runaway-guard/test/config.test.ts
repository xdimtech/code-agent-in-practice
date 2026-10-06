import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DEFAULT_CONFIG, parseOverride, resolveConfig } from "../src/config.ts";

test("parseOverride：形状不对的字段直接忽略", () => {
	assert.deepEqual(parseOverride({ enabled: "yes", threshold: 2, maxSteps: 0 }), {});
	assert.deepEqual(parseOverride({ threshold: 3.5, maxSteps: -1 }), {});
	assert.deepEqual(parseOverride([true]), {});
	assert.deepEqual(parseOverride(null), {});
	assert.deepEqual(parseOverride({ enabled: false, threshold: 5, maxSteps: 40 }), { enabled: false, threshold: 5, maxSteps: 40 });
});

test("resolveConfig：什么都不给就是默认值，默认没有硬上限", () => {
	assert.deepEqual(resolveConfig(undefined), DEFAULT_CONFIG);
	assert.equal(resolveConfig(undefined).maxSteps, undefined);
});

test("resolveConfig：远端优先于本地", () => {
	const config = resolveConfig({ enabled: true, threshold: 4 }, { enabled: false });
	assert.equal(config.enabled, false);
	assert.equal(config.threshold, 4);
});

test("resolveConfig：远端值坏了算「没覆盖」，回落到本地，不当成开或关", () => {
	assert.equal(resolveConfig({ enabled: false }, { enabled: "yes" }).enabled, false);
	assert.equal(resolveConfig({ enabled: true }, { enabled: "no" }).enabled, true);
	assert.equal(resolveConfig({ threshold: 4 }, { threshold: 1 }).threshold, 4);
});

test("resolveConfig：坏字段旁边的好字段照样生效", () => {
	const config = resolveConfig(undefined, { enabled: "yes", maxSteps: 5 });
	assert.deepEqual({ enabled: config.enabled, maxSteps: config.maxSteps }, { enabled: true, maxSteps: 5 });
});

test("resolveConfig：不修改 base", () => {
	const base = { ...DEFAULT_CONFIG };
	resolveConfig({ threshold: 9 }, undefined, base);
	assert.deepEqual(base, DEFAULT_CONFIG);
});
