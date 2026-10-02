import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLedger } from "./ledger.ts";
import { fateCounts, reconcile } from "./reconcile.ts";
import type { FileState, TriagedFile } from "./types.ts";

const entry = (date: string, title: string, pkg: string, files: string): string =>
  `### ${date} — ${title}\n\n- Reason: r\n- Affected package: \`${pkg}\`\n- Files: ${files}\n- Change type: generic\n- Upstream PR: not opened.\n- Validation: v\n`;
const t = (o: Record<string, FileState>): TriagedFile[] => Object.entries(o).map(([path, state]) => ({ path, state }));

const LEDGER = [
  entry("2026-08-05", "钩子", "packages/agent", "src/agent-loop.ts, src/types.ts"),
  entry("2026-08-04", "回放", "packages/ai", "src/providers/anthropic.ts"),
  entry("2026-08-03", "导出", "packages/ai", "src/index.ts"),
  entry("2026-08-02", "撤回过的", "packages/ai", "src/stream.ts"),
  entry("2026-08-01", "只有说明", "packages/ai", ""),
].join("\n");

const FILES = t({
  "packages/agent/src/agent-loop.ts": "conflict",
  "packages/agent/src/types.ts": "keep-ours",
  "packages/ai/src/types.ts": "take-upstream",
  "packages/ai/src/providers/anthropic.ts": "same-change",
  "packages/ai/src/index.ts": "keep-ours",
  "packages/ai/src/stream.ts": "untouched",
  "packages/tui/src/keys.ts": "keep-ours",
  "packages/tui/src/tui.ts": "take-upstream",
});

test("每条补丁的去向", () => {
  const { fates } = reconcile(parseLedger(LEDGER).entries, FILES);
  assert.deepEqual(fates.map((f) => f.fate), ["rework", "drop", "carry", "stale", "unlinked"]);
  assert.deepEqual([...fateCounts(fates)], [["rework", 1], ["drop", 1], ["carry", 1], ["stale", 1], ["unlinked", 1]]);
});

test("同名文件按 Affected package 缩小范围", () => {
  const { fates } = reconcile(parseLedger(LEDGER).entries, FILES);
  assert.deepEqual(fates[0].files.map((f) => f.path), ["packages/agent/src/agent-loop.ts", "packages/agent/src/types.ts"]);
});

test("台账没记的改动报出来；只有上游改的不报", () => {
  const { findings } = reconcile(parseLedger(LEDGER).entries, FILES);
  assert.deepEqual(findings.map((f) => f.rule), ["unledgered-change", "stale-entry", "unlinked-entry"]);
  assert.match(findings[0].message, /packages\/tui\/src\/keys\.ts/);
});

test("包被提到了、文件没被点名：降为提醒", () => {
  const files = t({ "packages/ai/src/index.ts": "keep-ours", "packages/ai/src/models.ts": "conflict", "packages/tui/src/keys.ts": "keep-ours" });
  const { findings } = reconcile(parseLedger(entry("2026-08-03", "导出", "packages/ai", "src/index.ts")).entries, files);
  assert.deepEqual(findings.map((f) => `${f.severity}:${f.rule}`), ["error:unledgered-change", "warn:package-level-only"]);
  assert.match(findings[1].message, /models\.ts/);
});

test("后缀匹配不跨文件名", () => {
  const { fates } = reconcile(parseLedger(entry("2026-08-01", "x", "packages/ai", "loop.ts")).entries, t({ "src/agent-loop.ts": "keep-ours" }));
  assert.equal(fates[0].fate, "unlinked");
});

test("空台账：所有本地改动都没记", () => {
  const { fates, findings } = reconcile([], FILES);
  assert.equal(fates.length, 0);
  assert.equal(findings.filter((f) => f.rule === "unledgered-change").length, 5);
});
