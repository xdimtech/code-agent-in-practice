import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelReply, classify } from "./protocol.ts";

test("响应：带 id 和 error", () => {
  assert.deepEqual(classify('{"type":"response","id":"req_1","command":"set_model","success":false,"error":"Model not found"}'), {
    kind: "response",
    id: "req_1",
    command: "set_model",
    success: false,
    error: "Model not found",
  });
});

test("响应：解析失败时没有 id", () => {
  const r = classify('{"type":"response","command":"parse","success":false,"error":"x"}');
  assert.equal(r.kind, "response");
  assert.equal("id" in r, false);
});

test("响应缺字段算坏行", () => {
  assert.equal(classify('{"type":"response","command":"prompt"}').kind, "bad");
});

test("对话框：有正数 timeout 才记下", () => {
  assert.deepEqual(classify('{"type":"extension_ui_request","id":"u1","method":"select","timeout":30000}'), { kind: "dialog", id: "u1", method: "select", timeout: 30000 });
  assert.deepEqual(classify('{"type":"extension_ui_request","id":"u2","method":"editor"}'), { kind: "dialog", id: "u2", method: "editor" });
  assert.deepEqual(classify('{"type":"extension_ui_request","id":"u3","method":"confirm","timeout":0}'), { kind: "dialog", id: "u3", method: "confirm" });
});

test("通知类 UI 请求不用回", () => {
  assert.deepEqual(classify('{"type":"extension_ui_request","id":"n","method":"notify","message":"hi"}'), { kind: "notice", method: "notify" });
});

test("不认识的 UI 方法、缺 id 的 UI 请求算坏行", () => {
  assert.equal(classify('{"type":"extension_ui_request","id":"x","method":"custom"}').kind, "bad");
  assert.equal(classify('{"type":"extension_ui_request","method":"confirm"}').kind, "bad");
});

test("其余带 type 的对象都是事件", () => {
  const r = classify('{"type":"agent_settled"}');
  assert.equal(r.kind, "event");
  assert.equal(r.kind === "event" && r.type, "agent_settled");
});

test("不是 JSON、不是对象、没有 type：坏行", () => {
  assert.match(classify("{oops").kind, /bad/);
  assert.equal(classify("[1,2]").kind, "bad");
  assert.equal(classify('{"type":3}').kind, "bad");
  assert.equal(classify("null").kind, "bad");
});

test("cancelReply 的形状", () => {
  assert.deepEqual(cancelReply("u1"), { type: "extension_ui_response", id: "u1", cancelled: true });
});
