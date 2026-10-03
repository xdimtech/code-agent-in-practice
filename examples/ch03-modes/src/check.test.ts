import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCaptured, detectMode, hasErrors } from "./check.ts";
import { jsonCapture, rpcCapture } from "./fixtures.ts";
import { MAX_LINE_BYTES, serializeLine } from "./jsonl.ts";

const rules = (text: string) => checkCaptured(text).findings.map((f) => f.rule);

test("detectMode：会话头 → json；有响应 → rpc；都没有 → unknown", () => {
  assert.equal(detectMode(['{"type":"session"}']), "json");
  assert.equal(detectMode(['{"type":"agent_start"}', '{"type":"response","command":"x","success":true}']), "rpc");
  assert.equal(detectMode(['{"type":"agent_start"}']), "unknown");
  assert.equal(detectMode([]), "unknown");
});

test("一轮成功的 json 输出：只有 U+2028 的提醒，没有错误", () => {
  const r = checkCaptured(jsonCapture());
  assert.equal(r.mode, "json");
  assert.equal(r.lines, 5);
  assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["unicode-separator", 3]]);
  assert.equal(hasErrors(r), false);
});

test("stopReason=error / aborted：报 run-failed（退出码说成功也不算数）", () => {
  for (const reason of ["error", "aborted"]) {
    const r = checkCaptured(jsonCapture(reason));
    assert.ok(rules(jsonCapture(reason)).includes("run-failed"), reason);
    assert.equal(hasErrors(r), true);
  }
});

test("没有 agent_end：这一轮没跑完", () => {
  const text = jsonCapture().split("\n").slice(0, 3).join("\n") + "\n";
  assert.ok(rules(text).includes("no-agent-end"));
});

test("截断：最后一行没有换行，而且不是 JSON", () => {
  const text = jsonCapture().slice(0, -5);
  const found = rules(text);
  assert.ok(found.includes("no-trailing-newline"));
  assert.ok(found.includes("not-json"));
});

test("rpc 输出：没有超时的对话框、失败的响应各报一条；带超时的不报，通知不报", () => {
  const r = checkCaptured(rpcCapture());
  assert.equal(r.mode, "rpc");
  assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [
    ["dialog-without-timeout", 2],
    ["failed-response", 5],
  ]);
  assert.equal(hasErrors(r), false);
});

test("超长行报 oversize", () => {
  const big = serializeLine({ type: "session" }) + serializeLine({ type: "message_update", text: "x".repeat(MAX_LINE_BYTES) });
  assert.ok(rules(big).includes("oversize"));
});

test("看不出是哪种输出：unknown-stream；空文本什么都不报", () => {
  assert.ok(rules('{"type":"agent_start"}\n').includes("unknown-stream"));
  assert.deepEqual(checkCaptured("").findings, []);
});
