import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./layers.ts";
import { PI_LAYERS, resolvePresets, STEP_CODE_LAYERS } from "./presets.ts";

test("两张预设的层名一致、顺序一致，对照时才能逐行对齐", () => {
  assert.deepEqual(
    STEP_CODE_LAYERS.map((l) => l.name),
    PI_LAYERS.map((l) => l.name),
  );
});

test("Step-Code 改名后的路径落到同一层", () => {
  assert.equal(classify("packages/agent-core/src/agent-loop.ts", STEP_CODE_LAYERS), "内核 L1（agent-loop.ts）");
  assert.equal(classify("packages/agent-core/src/harness/reducer.ts", STEP_CODE_LAYERS), "v2 harness（未接线）");
  assert.equal(classify("packages/agent-core/src/agent.ts", STEP_CODE_LAYERS), "运行时 v1（agent 其余）");
  assert.equal(classify("packages/providers/src/stream.ts", STEP_CODE_LAYERS), "Provider 适配（ai）");
  assert.equal(classify("apps/cli/src/main.ts", STEP_CODE_LAYERS), "CLI 外壳（apps/cli）");
});

test("一个名字对所有仓库生效", () => {
  assert.deepEqual(resolvePresets("pi", 2), [PI_LAYERS, PI_LAYERS]);
});

test("a,b 给两个仓库各配一张表", () => {
  assert.deepEqual(resolvePresets("pi,step-code", 2), [PI_LAYERS, STEP_CODE_LAYERS]);
});

test("名字认不出、或个数和仓库数对不上，返回 undefined", () => {
  assert.equal(resolvePresets("nope", 1), undefined);
  assert.equal(resolvePresets("pi,nope", 2), undefined);
  assert.equal(resolvePresets("pi,step-code", 1), undefined);
});
