import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecorder } from "./recorder.ts";
import { firstDiff, replayAll, replayStep } from "./replay.ts";
import { exchanges, parseTape } from "./tape.ts";

const SK = "s" + "k-" + "Ab3".repeat(8);
const p1 = { model: "m", system: "You are helpful.", messages: [{ role: "user", content: `key ${SK}` }] };
const p2 = { ...p1, messages: [...p1.messages, { role: "assistant", content: "ok" }, { role: "user", content: "next" }] };

function record(payloads: readonly unknown[], answered = payloads.length) {
  const lines: string[] = [];
  const r = createRecorder({ now: () => "t", append: (l) => lines.push(l) });
  payloads.forEach((p, i) => {
    r.onRequest(p, { sessionId: "s", leafId: null });
    if (i < answered) r.onAssistantMessage({ role: "assistant", content: [{ type: "text", text: `answer ${i + 1}` }] });
  });
  return exchanges(parseTape(lines.join("")));
}

test("第一处差异给出 JSONPath；相同返回 undefined", () => {
  assert.equal(firstDiff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), undefined);
  assert.deepEqual(firstDiff({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }), { path: "$.a[1].b", a: 2, b: 3 });
  assert.equal(firstDiff({ a: [1] }, { a: [1, 2] })?.path, "$.a[1]");
  assert.equal(firstDiff({ a: 1 }, { a: 1, z: 0 })?.path, "$.z");
});

test("原样重跑全部命中，交出当时录下的回答；带密钥的请求先脱敏再比", () => {
  const results = replayAll(record([p1, p2]), [p1, p2]);
  assert.deepEqual(results.map((r) => r.kind), ["hit", "hit"]);
  const first = results[0]!;
  assert.ok(first.kind === "hit");
  assert.match(JSON.stringify(first.message), /answer 1/);
});

test("改了系统提示词：停在第一个请求，指出位置；长字符串从分岔处附近显示", () => {
  const tape = record([p1, p2]);
  const changed = { ...p1, system: "You are helpful. Never run rm." };
  const results = replayAll(tape, [changed, p2]);
  assert.equal(results.length, 1);
  const r = results[0]!;
  assert.ok(r.kind === "diverged");
  assert.equal(r.path, "$.system");
  assert.notEqual(r.recorded, r.incoming);
  const long = "x".repeat(80);
  const d = replayStep(record([{ s: `${long}A` }]), 0, { s: `${long}B` });
  assert.ok(d.kind === "diverged" && d.recorded.endsWith("A") && d.incoming.endsWith("B") && d.recorded.startsWith("…"));
});

test("磁带里有请求没回答，或者问的比录的多", () => {
  const tape = record([p1, p2], 1);
  assert.deepEqual(replayAll(tape, [p1, p2]).map((r) => r.kind), ["hit", "no-answer"]);
  assert.deepEqual(replayStep(tape, 2, p1), { kind: "exhausted", asked: 3, recorded: 2 });
});
