import { test } from "node:test";
import assert from "node:assert/strict";
import { JournalCorruption, restore, validate, type JournalRecord } from "./journal.ts";

const plan: JournalRecord = {
  type: "batch_planned",
  seq: 1,
  batchId: "b1",
  calls: [
    { id: "c0", name: "rm", args: {} },
    { id: "c1", name: "read", args: {} },
    { id: "c2", name: "read", args: {} },
  ],
};
const start = (seq: number, toolIndex: number, toolCallId = `c${toolIndex}`): JournalRecord => ({
  type: "tool_started",
  seq,
  batchId: "b1",
  toolIndex,
  toolCallId,
  replay: "never",
});
const done = (seq: number, toolIndex: number): JournalRecord => ({
  type: "tool_settled",
  seq,
  batchId: "b1",
  toolIndex,
  toolCallId: `c${toolIndex}`,
  text: "ok",
  isError: false,
});

test("折叠出每个调用的三种状态", () => {
  const state = restore([plan, start(2, 0), done(3, 0), start(4, 1)]);
  assert.deepEqual(state?.calls.map((c) => c.status), ["completed", "effect_pending", "planned"]);
});

test("没有批次时返回 null", () => {
  assert.equal(restore([]), null);
});

const corrupted: [string, JournalRecord[]][] = [
  ["non_monotonic_seq", [plan, start(2, 0), done(2, 0)]],
  ["unknown_batch", [plan, { ...start(2, 0), batchId: "b9" }]],
  ["tool_call_mismatch", [plan, start(2, 1, "c0")]],
  ["tool_call_mismatch", [plan, start(2, 7, "c7")]],
  ["duplicate_tool_invocation", [plan, start(2, 0), start(3, 0)]],
  ["settled_without_start", [plan, done(2, 0)]],
  ["duplicate_settlement", [plan, start(2, 0), done(3, 0), done(4, 0)]],
  ["multiple_open_batches", [plan, start(2, 0), { ...plan, seq: 3, batchId: "b2" }]],
];

for (const [reason, records] of corrupted) {
  test(`协议不可能产生的状态被拒绝：${reason}`, () => {
    assert.throws(
      () => validate(records),
      (e: unknown) => e instanceof JournalCorruption && e.reason === reason,
    );
  });
}

test("写到一半不是损坏：意图在、结算缺失是合法前缀", () => {
  assert.doesNotThrow(() => validate([plan, start(2, 0)]));
});
