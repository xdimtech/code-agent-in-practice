import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, createRecorder, fingerprint, keepHeaders, type TapeRecord } from "./recorder.ts";
import { REDACTED } from "./redact.ts";

const SK = "s" + "k-" + "Ab3".repeat(8);

const capture = () => {
  const lines: string[] = [];
  const recorder = createRecorder({ now: () => "2026-10-01T00:00:00.000Z", append: (l) => lines.push(l) });
  const records = () => lines.map((l) => JSON.parse(l) as TapeRecord);
  return { recorder, lines, records };
};

test("键的顺序不影响指纹，值不同指纹就不同", () => {
  assert.equal(canonical({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  assert.equal(canonical({ a: undefined, b: null }), '{"b":null}');
});

test("响应头只留排障用得上的，键统一小写", () => {
  const kept = keepHeaders({ "Retry-After": "3", "request-id": "r", "anthropic-ratelimit-tokens-remaining": "9", "set-cookie": "sid=1", Authorization: "x" });
  assert.deepEqual(Object.keys(kept).sort(), ["anthropic-ratelimit-tokens-remaining", "request-id", "retry-after"]);
});

test("一次请求录成三行，共用一个 seq；请求钩子永远返回 undefined", () => {
  const { recorder, records } = capture();
  const ret = recorder.onRequest({ model: "m", messages: [] }, { sessionId: "s-1", leafId: "e1" });
  assert.equal(ret, undefined);
  recorder.onResponse(200, { "x-request-id": "q" });
  recorder.onAssistantMessage({ role: "assistant", content: [] });
  recorder.onRequest({ model: "m", messages: [1] }, { sessionId: "s-1", leafId: "e2" });
  assert.deepEqual(records().map((r) => [r.kind, r.seq]), [["request", 1], ["response", 1], ["message", 1], ["request", 2]]);
  const first = records()[0]!;
  assert.ok(first.kind === "request" && first.leafId === "e1" && first.fingerprint === fingerprint({ model: "m", messages: [] }));
});

test("请求体和助手消息落盘前脱敏，指纹按脱敏后的算", () => {
  const { recorder, lines, records } = capture();
  const payload = { system: "s", messages: [{ role: "user", content: `export OPENAI_API_KEY=${SK}` }] };
  recorder.onRequest(payload, { sessionId: "s-1", leafId: null });
  recorder.onAssistantMessage({ role: "assistant", content: [{ type: "text", text: SK }] });
  assert.ok(lines.every((l) => !l.includes(SK)));
  const req = records()[0]!;
  assert.ok(req.kind === "request");
  assert.equal(req.redactedSecrets, 1);
  assert.match(JSON.stringify(req.payload), new RegExp(REDACTED.replace(/[[\]]/g, "\\$&")));
  assert.notEqual(req.fingerprint, fingerprint(payload));
  assert.ok(payload.messages[0]!.content.includes(SK), "不改入参");
});

test("写盘失败就让它抛出去", () => {
  const recorder = createRecorder({ now: () => "t", append: () => { throw new Error("EACCES"); } });
  assert.throws(() => recorder.onRequest({}, { sessionId: "s", leafId: null }), /EACCES/);
});
