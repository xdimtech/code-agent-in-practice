import { strict as assert } from "node:assert";
import { test } from "node:test";

import { checkImport, layerOfPath, resolveTarget } from "../src/classify.ts";
import { SELF_TEST_CONFIG as config } from "../src/self-test.ts";

test("layerOfPath：最长前缀胜出", () => {
	assert.equal(layerOfPath(config, "apps/cli/src/main.ts")?.name, "app");
	assert.equal(layerOfPath(config, "apps/cli/src/ui/render.ts")?.name, "app-ui");
	assert.equal(layerOfPath(config, "apps/cli/README.md"), undefined);
});

test("layerOfPath：前缀按目录比，packages/core/srcx 不算 packages/core/src", () => {
	assert.equal(layerOfPath(config, "packages/core/srcx/a.ts"), undefined);
});

test("resolveTarget：相对路径先归一化再归层", () => {
	assert.deepEqual(resolveTarget(config, "packages/core/src/a/b.ts", "../../../ui/src/x.ts"), { kind: "layer", layer: config.layers[2] });
	assert.deepEqual(resolveTarget(config, "packages/core/src/a.ts", "../../../tmp/x.ts"), { kind: "unassigned", resolved: "tmp/x.ts" });
});

test("resolveTarget：外部包、内部 scope、子路径", () => {
	assert.deepEqual(resolveTarget(config, "packages/core/src/a.ts", "@sinclair/typebox"), { kind: "external" });
	assert.deepEqual(resolveTarget(config, "packages/core/src/a.ts", "@demo/ui/theme"), { kind: "layer", layer: config.layers[2] });
	assert.deepEqual(resolveTarget(config, "packages/core/src/a.ts", "@demo/nope"), { kind: "unassigned", resolved: "@demo/nope" });
});

test("checkImport：违规带上种类和可读的说明", () => {
	const violation = checkImport(config, "packages/ui/src/view.ts", "@demo/core");
	assert.equal(violation?.kind, "forbidden-edge");
	assert.match(violation!.message, /ui → core 不在 ui\.mayImport 里/);
});

test("checkImport：同层导入总是允许，即使 mayImport 为空", () => {
	assert.equal(checkImport(config, "packages/contracts/src/a.ts", "./b.ts"), undefined);
	assert.equal(checkImport(config, "packages/contracts/src/a.ts", "@demo/contracts"), undefined);
});

test("checkImport：没有 internalScopes 时，认不出的包当外部放行——这是配置要承担的风险", () => {
	const open = { ...config, internalScopes: [] };
	assert.equal(checkImport(open, "packages/core/src/a.ts", "@demo/unknown"), undefined);
	assert.equal(checkImport(config, "packages/core/src/a.ts", "@demo/unknown")?.kind, "unassigned-target");
});
