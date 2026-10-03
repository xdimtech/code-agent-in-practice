import assert from "node:assert/strict";
import { test } from "node:test";
import { initialHost, receive, send, stuckDialogs } from "./host.ts";

const line = (v: unknown) => JSON.stringify(v);

test("send：每条命令编号，记进 pending；旧状态不变", () => {
  const s0 = initialHost();
  const a = send(s0, { type: "prompt", message: "hi" });
  const b = send(a.state, { type: "get_state" });
  assert.deepEqual(JSON.parse(a.line), { type: "prompt", message: "hi", id: "req_1" });
  assert.equal(JSON.parse(b.line).id, "req_2");
  assert.deepEqual([...b.state.pending], [["req_1", "prompt"], ["req_2", "get_state"]]);
  assert.equal(s0.pending.size, 0);
  assert.equal(s0.nextId, 1);
});

test("成功响应：从 pending 里划掉", () => {
  const { state } = send(initialHost(), { type: "prompt" });
  const step = receive(state, line({ type: "response", id: "req_1", command: "prompt", success: true }), "cancel");
  assert.equal(step.state.pending.size, 0);
  assert.deepEqual(step.state.problems, []);
  assert.equal(state.pending.size, 1);
});

test("失败响应：划掉并记一条问题", () => {
  const { state } = send(initialHost(), { type: "set_model" });
  const step = receive(state, line({ type: "response", id: "req_1", command: "set_model", success: false, error: "Model not found" }), "cancel");
  assert.equal(step.state.pending.size, 0);
  assert.deepEqual(step.state.problems, ["set_model 失败：Model not found"]);
});

test("对不上请求的响应（比如 parse 错误）记成问题", () => {
  const step = receive(initialHost(), line({ type: "response", command: "parse", success: false, error: "bad" }), "cancel");
  assert.match(step.state.problems[0], /对不上请求的响应（parse）/);
});

test("对话框 + cancel：立刻回取消，不留下打开的对话框", () => {
  const step = receive(initialHost(), line({ type: "extension_ui_request", id: "u1", method: "confirm" }), "cancel");
  assert.deepEqual(step.out.map((o) => JSON.parse(o)), [{ type: "extension_ui_response", id: "u1", cancelled: true }]);
  assert.deepEqual(step.state.dialogs, []);
});

test("对话框 + ignore：不回；没有超时的算挂住", () => {
  let s = initialHost();
  s = receive(s, line({ type: "extension_ui_request", id: "u1", method: "confirm" }), "ignore").state;
  s = receive(s, line({ type: "extension_ui_request", id: "u2", method: "select", timeout: 5000 }), "ignore").state;
  assert.equal(s.dialogs.length, 2);
  assert.deepEqual(stuckDialogs(s), [{ id: "u1", method: "confirm" }]);
});

test("通知不用回；agent_settled 计数；坏行记问题", () => {
  let s = initialHost();
  const n = receive(s, line({ type: "extension_ui_request", id: "n", method: "notify" }), "cancel");
  assert.deepEqual(n.out, []);
  s = receive(n.state, line({ type: "agent_settled" }), "cancel").state;
  s = receive(s, line({ type: "agent_start" }), "cancel").state;
  assert.equal(s.settled, 1);
  s = receive(s, "第二段", "cancel").state;
  assert.equal(s.problems.length, 1);
});
