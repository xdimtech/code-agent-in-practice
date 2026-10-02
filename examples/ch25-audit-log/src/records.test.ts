import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { digestContent, isJsonRecord, sessionStarted, toolExecuted, toolProposed, toolSettled, userBash } from "./records.ts";

const call = { toolCallId: "c1", toolName: "bash" };

test("输出只记摘要：字节数、sha256、图片张数和大小，不记原文", () => {
  const secret = "TOKEN=" + "abc".repeat(8);
  const d = digestContent([{ type: "text", text: secret }, { type: "image", data: "AAAA", mimeType: "image/png" }, null, "x"]);
  assert.equal(d.textBytes, secret.length);
  assert.equal(d.textSha256, createHash("sha256").update(secret).digest("hex"));
  assert.equal(d.images, 1);
  assert.equal(d.imageBytes, 3);
  assert.ok(!JSON.stringify(d).includes(secret));
});

test("tool.executed 记执行时的参数和漂移；没见过 proposed 时漂移为 null", () => {
  const e = toolExecuted({ ...call, input: { command: "timeout 600 npm test" }, proposed: { command: "npm test" }, content: [{ type: "text", text: "ok" }], isError: false, truncated: false });
  assert.equal(e.kind, "tool.executed");
  assert.ok(isJsonRecord(e.body));
  assert.deepEqual(e.body.drift, ["command"]);
  const orphan = toolExecuted({ ...call, input: {}, proposed: undefined, content: [], isError: false, truncated: false });
  assert.ok(isJsonRecord(orphan.body));
  assert.equal(orphan.body.drift, null);
});

test("截断时记下完整输出文件的路径和摘要；读不到就记原因", () => {
  const base = { ...call, input: {}, proposed: {}, content: [], isError: false, truncated: true, fullOutputPath: "/tmp/pi-bash-1.log" };
  const ok = toolExecuted({ ...base, fullOutput: { bytes: 10, sha256: "f".repeat(64) } }).body;
  assert.ok(isJsonRecord(ok));
  assert.deepEqual(ok.fullOutput, { path: "/tmp/pi-bash-1.log", bytes: 10, sha256: "f".repeat(64) });
  const gone = toolExecuted(base).body;
  assert.ok(isJsonRecord(gone));
  assert.deepEqual(gone.fullOutput, { path: "/tmp/pi-bash-1.log", error: "没有读" });
});

test("proposed / settled / user.bash / session.started 的形状", () => {
  assert.deepEqual(toolProposed(call, { command: "ls" }).body, { ...call, args: { command: "ls" } });
  assert.deepEqual(toolSettled(call, true, false).body, { ...call, isError: true, executed: false });
  assert.deepEqual(userBash({ command: "ls", cwd: "/w", excludeFromContext: false }, "磁盘满").body, { command: "ls", cwd: "/w", excludeFromContext: false, refused: "磁盘满" });
  assert.equal(sessionStarted({ reason: "startup", sessionId: "s", alg: "sha256" }).kind, "session.started");
});

test("参数里有 JSON 表示不了的值就报错，不悄悄丢掉", () => {
  assert.throws(() => toolProposed(call, { n: Number.NaN }), /不是有限数/);
});
