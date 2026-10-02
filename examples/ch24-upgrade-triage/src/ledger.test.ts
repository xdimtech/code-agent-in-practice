import assert from "node:assert/strict";
import { test } from "node:test";
import { changeKind, mentionedPaths, parseLedger, upstreamStatus } from "./ledger.ts";

const GOOD = `# 本地补丁

## 补丁台账

### 2026-08-22 — 工具钩子能结束整个 agent

- Reason: 宿主钩子要能一票否决整轮。
- Affected package: \`packages/agent\`，改 \`src/agent-loop.ts\` 和 \`src/types.ts\`。
- Change type: generic upstreamable control seam.
- Upstream PR: not opened.
- Validation: \`pnpm --filter agent test\`

### 2026-07-31 — 回放签名过的空 thinking

- Reason: 空 thinking 带签名时被丢掉。
- Affected package: \`packages/ai\`
- Files: packages/ai/src/providers/anthropic.ts
- Change type: selective generic upstream material from upstream PR #6457.
- Upstream PR: already merged as #6457.
- Validation: provider tests.
`;

test("合格的台账：两条、无问题", () => {
  const { entries, findings } = parseLedger(GOOD);
  assert.equal(entries.length, 2);
  assert.deepEqual(findings, []);
  assert.equal(entries[0].date, "2026-08-22");
  assert.equal(entries[0].title, "工具钩子能结束整个 agent");
  assert.equal(entries[0].line, 5);
});

test("路径：反引号里像文件的词 + Files 字段；包名、命令、目录不算", () => {
  const { entries } = parseLedger(GOOD);
  assert.deepEqual(entries[0].paths, ["src/agent-loop.ts", "src/types.ts"]);
  assert.deepEqual(entries[1].paths, ["packages/ai/src/providers/anthropic.ts"]);
  assert.deepEqual(mentionedPaths(new Map(), ["- 改了 `@scope/pkg` 和 `packages/ai` 和 `a b.ts`"]), []);
});

test("上游状态与改动性质", () => {
  const { entries } = parseLedger(GOOD);
  assert.equal(upstreamStatus(entries[0]), "not-opened");
  assert.equal(upstreamStatus(entries[1]), "merged");
  assert.equal(changeKind(entries[0]), "upstreamable");
});

const DRIFTED = `## Local patch ledger

### 2026-08-10 — 甲

- Reason: r
- Affected package: a
- Change type: MiniMax-specific host glue.
- Upstream PR: not opened.
- Validation: v

### 2026-08-11 — 乙，排错了位置

- Reason: r
- Affected packages: a, b
- Type: generic, upstreamable execution interface.
- Validation: v

## 2026-09-08: 丙，标题级别不对

- Reason: r
- Validation: v

### 2026-02-30 — 丁，日期不存在

- Reason: r
- Affected package: a
- Change type: x
- Upstream PR: see https://example.invalid/pull/12
- Validation: v
`;

test("格式漂移逐条报：级别、别名、缺字段、顺序、坏日期", () => {
  const { entries, findings } = parseLedger(DRIFTED);
  assert.equal(entries.length, 4);
  const rules = findings.map((f) => f.rule);
  assert.deepEqual(rules.filter((r) => r === "heading-level").length, 1);
  assert.deepEqual(rules.filter((r) => r === "field-alias").length, 2);
  assert.deepEqual(rules.filter((r) => r === "missing-field").length, 4);
  assert.deepEqual(rules.filter((r) => r === "out-of-order").length, 2);
  assert.deepEqual(rules.filter((r) => r === "bad-date").length, 1);
  assert.match(findings.find((f) => f.rule === "heading-level")?.message ?? "", /第 18 行用了 ##/);
});

test("别名照样读得出值", () => {
  const { entries } = parseLedger(DRIFTED);
  assert.equal(changeKind(entries[0]), "downstream-only");
  assert.equal(changeKind(entries[1]), "upstreamable");
  assert.equal(upstreamStatus(entries[1]), "unknown");
  assert.equal(upstreamStatus(entries[3]), "opened");
  assert.equal(changeKind(entries[3]), "unknown");
});

test("空文件：一条提示，不抛错", () => {
  const { entries, findings } = parseLedger("# 什么都没有\n");
  assert.equal(entries.length, 0);
  assert.deepEqual(findings.map((f) => f.rule), ["empty"]);
});
