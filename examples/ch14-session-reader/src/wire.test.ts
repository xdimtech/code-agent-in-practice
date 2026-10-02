import assert from "node:assert/strict";
import { test } from "node:test";
import { assistant, compaction, result, user } from "./fixtures.ts";
import type { Entry } from "./types.ts";
import { COMPACTION_PREFIX, IMAGE_PLACEHOLDER, NO_RESULT, toWire } from "./wire.ts";

const bash = (id: string, parentId: string, excludeFromContext = false): Entry => ({
  type: "message",
  id,
  parentId,
  timestamp: "2026-09-30T02:14:05.000Z",
  message: { role: "bashExecution", command: "ls", output: "a\nb", exitCode: 1, cancelled: false, truncated: false, excludeFromContext, timestamp: 0 },
});

const withImage = (id: string, parentId: string): Entry => ({
  ...user(id, parentId),
  message: { role: "user", content: [{ type: "text", text: "看图" }, { type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: 0 },
});

test("正常的一来一回原样发", () => {
  const ctx = [user("u1", null), assistant("a1", "u1", { calls: [{ id: "t1", name: "bash", args: { command: "ls" } }] }), result("r1", "a1", "t1")];
  const { messages, dropped } = toWire(ctx, { vision: true });
  assert.deepEqual(messages.map((m) => [m.role, m.from]), [["user", "u1"], ["assistant", "a1"], ["toolResult", "r1"]]);
  assert.equal(messages[1]!.calls?.[0]?.id, "t1");
  assert.deepEqual(dropped, []);
});

test("压缩摘要和 ! 命令变成 user 消息；!! 命令不发", () => {
  const ctx = [compaction("c1", "x", "u1"), user("u1", "c1"), bash("b1", "u1"), bash("b2", "b1", true)];
  const { messages, dropped } = toWire(ctx, { vision: true });
  assert.deepEqual(messages.map((m) => m.role), ["user", "user", "user"]);
  assert.ok(messages[0]!.text.startsWith(COMPACTION_PREFIX));
  assert.match(messages[2]!.text, /Ran `ls`[\s\S]*exited with code 1/);
  assert.deepEqual(dropped.map((d) => d.from), ["b2"]);
});

test("出错的助手消息整条丢掉，它的工具调用也就不需要补结果", () => {
  const ctx = [user("u1", null), assistant("a1", "u1", { stopReason: "error", errorMessage: "429", calls: [{ id: "t1", name: "bash", args: {} }] }), user("u2", "a1")];
  const { messages, dropped } = toWire(ctx, { vision: true });
  assert.deepEqual(messages.map((m) => m.from), ["u1", "u2"]);
  assert.match(dropped[0]!.reason, /stopReason=error/);
});

test("没有结果的工具调用：下一条 user 之前、以及末尾，都补一条假结果", () => {
  const call = (id: string) => ({ id, name: "bash", args: {} });
  const ctx = [user("u1", null), assistant("a1", "u1", { calls: [call("t1"), call("t2")] }), result("r1", "a1", "t1"), user("u2", "r1"), assistant("a2", "u2", { calls: [call("t3")] })];
  const { messages } = toWire(ctx, { vision: true });
  const fake = messages.filter((m) => m.from === null);
  assert.equal(fake.length, 2);
  assert.ok(fake.every((m) => m.role === "toolResult" && m.text === NO_RESULT));
  assert.match(fake[0]!.note!, /t2/);
  assert.match(fake[1]!.note!, /t3/);
  assert.equal(messages.indexOf(fake[0]!), 3, "补在 r1 之后、u2 之前");
  assert.equal(messages.at(-1), fake[1]);
});

test("模型不支持图片时换成占位文本，并说明换了几张", () => {
  const blind = toWire([withImage("u1", "x")], { vision: false }).messages[0]!;
  assert.ok(blind.text.includes(IMAGE_PLACEHOLDER));
  assert.match(blind.note!, /1 张图片/);
  assert.equal(toWire([withImage("u1", "x")], { vision: true }).messages[0]!.note, undefined);
});

test("记录型条目不发；不改入参", () => {
  const change: Entry = { type: "model_change", id: "m1", parentId: "u1", timestamp: "t", provider: "p", modelId: "m" };
  const ctx = Object.freeze([user("u1", null), change]);
  const { messages, dropped } = toWire(ctx, { vision: true });
  assert.equal(messages.length, 1);
  assert.match(dropped[0]!.reason, /model_change/);
});
