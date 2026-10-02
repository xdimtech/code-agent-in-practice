import assert from "node:assert/strict";
import { test } from "node:test";
import { exchanges, parseTape, payloadShape, TapeFormatError } from "./tape.ts";

const req = (seq: number, extra: Record<string, unknown> = {}) => ({ kind: "request", seq, at: "t", sessionId: "s-1", leafId: null, fingerprint: "f", redactedSecrets: 0, payload: {}, ...extra });
const res = (seq: number, status = 200) => ({ kind: "response", seq, at: "t", status, headers: {} });
const msg = (seq: number) => ({ kind: "message", seq, at: "t", message: { role: "assistant" } });
const tape = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("按 seq 归成一次次请求；缺响应头的保留为空", () => {
  const xs = exchanges(parseTape(tape(req(1), res(1), msg(1), req(2), msg(2))));
  assert.equal(xs.length, 2);
  assert.equal(xs[0]!.response?.status, 200);
  assert.equal(xs[1]!.response, undefined);
  assert.ok(xs[1]!.message);
});

test("空行跳过；坏行、缺字段、不认识的 kind 都报错并带行号", () => {
  assert.equal(parseTape(`\n${tape(req(1))}\n\n`).length, 1);
  assert.throws(() => parseTape(`${tape(req(1))}{oops`), (e: unknown) => e instanceof TapeFormatError && /第 2 行不是合法 JSON/.test(e.message));
  assert.throws(() => parseTape(tape({ kind: "request", at: "t" })), /第 1 行不是磁带记录/);
  assert.throws(() => parseTape(tape({ ...req(1), seq: 0 })), /缺 seq/);
  assert.throws(() => parseTape(tape({ kind: "trace", seq: 1, at: "t" })), /kind 不认识/);
  assert.throws(() => parseTape(tape({ kind: "response", seq: 1, at: "t", status: "200", headers: {} })), /字段不全/);
});

test("两盘磁带写进一个文件、或者有响应没请求，都报错", () => {
  assert.throws(() => exchanges(parseTape(tape(req(1), req(1)))), /seq 1 出现了两次请求/);
  assert.throws(() => exchanges(parseTape(tape(req(1), res(2)))), /seq 2 有 response 但没有请求/);
});

test("请求体形状：认 messages / input、system / instructions", () => {
  const anthropic = payloadShape({ model: "c", system: [{ type: "text", text: "abc" }, { type: "text", text: "de" }], messages: [{ role: "user" }, { role: "assistant" }], tools: [{}, {}] });
  assert.deepEqual(anthropic, { model: "c", systemChars: 5, roles: ["user", "assistant"], tools: 2 });
  const responses = payloadShape({ model: "g", instructions: "xyz", input: [{ type: "function_call_output" }] });
  assert.deepEqual(responses, { model: "g", systemChars: 3, roles: ["function_call_output"], tools: 0 });
  assert.deepEqual(payloadShape("nope"), { model: "?", systemChars: 0, roles: [], tools: 0 });
});
