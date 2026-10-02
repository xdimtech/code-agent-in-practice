import assert from "node:assert/strict";
import { test } from "node:test";
import { assistant, compaction, result, user } from "./fixtures.ts";
import { describe, PREVIEW_CHARS, timeline } from "./timeline.ts";
import type { Entry } from "./types.ts";

test("用户消息：长文本截断、多行压成一行、图片计数", () => {
  assert.match(describe(user("a", null, "x".repeat(PREVIEW_CHARS + 5))), new RegExp(`x{${PREVIEW_CHARS}}…$`));
  assert.match(describe(user("a", null, "one\n\ntwo")), /one two$/);
  const img: Entry = { ...user("a", null), message: { role: "user", content: [{ type: "text", text: "看图" }, { type: "image", data: "", mimeType: "image/png" }], timestamp: 0 } };
  assert.match(describe(img), /看图 \[\+1 张图\]/);
});

test("助手消息：停止原因、工具调用、错误", () => {
  assert.match(describe(assistant("b", "a", { calls: [{ id: "t", name: "bash", args: { command: "ls" } }] })), /\[toolUse\] bash\(\{"command":"ls"\}\)/);
  assert.match(describe(assistant("b", "a", { stopReason: "error", errorMessage: "429" })), /\[error\]  ✗ 429/);
});

test("工具结果、! 命令、压缩、模型切换、自定义条目", () => {
  assert.match(describe(result("c", "b", "t", true)), /toolResult ✗ bash: ok/);
  const bash: Entry = {
    type: "message", id: "d", parentId: null, timestamp: "t",
    message: { role: "bashExecution", command: "make", output: "", exitCode: 2, cancelled: false, truncated: true, fullOutputPath: "/tmp/f", timestamp: 0 },
  };
  assert.match(describe(bash), /!bash +make → exit 2（截断，全文在 \/tmp\/f）/);
  assert.match(describe(compaction("k", "a", "a")), /压缩前 100 tokens，保留自 a/);
  assert.match(describe({ type: "model_change", id: "m", parentId: null, timestamp: "t", provider: "o", modelId: "auto" }), /→ o\/auto/);
  assert.equal(describe({ type: "custom", id: "x", parentId: null, timestamp: "t", customType: "todo" }), "custom     todo");
});

test("时间线：时间、id，被压缩掉的打 ░", () => {
  const lines = timeline([user("a", null), user("b", "a")], { inContext: new Set(["b"]) });
  assert.match(lines[0]!, /^░ 02:14:05 a user/);
  assert.match(lines[1]!, /^  02:14:05 b user/);
  assert.ok(timeline([user("a", null)]).every((l) => l.startsWith(" ")));
});
