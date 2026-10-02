import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLayerName, classify, grandTotal, REST, summarize, type SourceFile } from "./layers.ts";
import { PI_LAYERS } from "./presets.ts";

const files: SourceFile[] = [
  { path: "packages/agent/src/agent-loop.ts", lines: 794 },
  { path: "packages/agent/src/agent.ts", lines: 592 },
  { path: "packages/agent/src/harness/reducer.ts", lines: 667 },
  { path: "packages/ai/src/stream.ts", lines: 100 },
  { path: "packages/coding-agent/src/main.ts", lines: 978 },
  { path: "packages/server/src/index.ts", lines: 50 },
];

test("窄的层排在前面：agent-loop.ts 和 harness/ 不会被 packages/agent/ 吞掉", () => {
  assert.equal(classify("packages/agent/src/agent-loop.ts", PI_LAYERS), "内核 L1（agent-loop.ts）");
  assert.equal(classify("packages/agent/src/harness/reducer.ts", PI_LAYERS), "v2 harness（未接线）");
  assert.equal(classify("packages/agent/src/agent.ts", PI_LAYERS), "运行时 v1（agent 其余）");
});

test("文件前缀是精确匹配，不是 startsWith", () => {
  assert.equal(classify("packages/agent/src/agent-loop.ts.bak", PI_LAYERS), "运行时 v1（agent 其余）");
});

test("按预设求和：保留空层、按预设顺序、未命中的进「其余」", () => {
  const rows = summarize(files, PI_LAYERS);
  assert.deepEqual(
    rows.map((r) => [r.name, r.lines]),
    [
      ["内核 L1（agent-loop.ts）", 794],
      ["v2 harness（未接线）", 667],
      ["运行时 v1（agent 其余）", 592],
      ["Provider 适配（ai）", 100],
      ["终端 UI（tui）", 0],
      ["产品层（coding-agent）", 978],
      ["CLI 外壳（apps/cli）", 0],
      [REST, 50],
    ],
  );
});

test("全部命中时不出现空的「其余」", () => {
  const rows = summarize(files.slice(0, 5), PI_LAYERS);
  assert.equal(rows.some((r) => r.name === REST), false);
});

test("无预设时按前两段路径分组，从大到小", () => {
  assert.equal(autoLayerName("packages/ai/src/x.ts"), "packages/ai");
  assert.equal(autoLayerName("lib/x.ts"), "lib");
  const rows = summarize(files);
  assert.deepEqual(rows[0], { name: "packages/agent", lines: 2053, files: 3 });
  assert.equal(rows.at(-1)?.name, "packages/server");
});

test("summarize 不改动入参", () => {
  const frozen = Object.freeze(files.map((f) => Object.freeze({ ...f })));
  assert.doesNotThrow(() => summarize(frozen, PI_LAYERS));
});

test("合计 = 各层之和", () => {
  assert.deepEqual(grandTotal(summarize(files, PI_LAYERS)), { name: "合计", lines: 3181, files: 6 });
});
