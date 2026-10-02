import assert from "node:assert/strict";
import { test } from "node:test";
import { PI_SESSION } from "./fixtures.ts";
import { inspectSession } from "./session-check.ts";

const rules = (text: string) => inspectSession(text).findings.map((f) => f.rule);

test("演示会话：数得出调用、结果、用户 !、外部输出和图片", () => {
  const { facts } = inspectSession(PI_SESSION);
  assert.equal(facts.toolCalls, 2);
  assert.equal(facts.toolResults, 2);
  assert.equal(facts.toolErrors, 1);
  assert.equal(facts.userBash, 1);
  assert.deepEqual(facts.externalOutputs, ["/tmp/pi-bash-4f2a.log"]);
  assert.equal(facts.images, 1);
});

test("演示会话：坏行、末行无换行、孤儿、外部输出、分不清的报错都报出来", () => {
  const { findings } = inspectSession(PI_SESSION);
  const by = (rule: string) => findings.filter((f) => f.rule === rule);
  assert.equal(by("malformed-line")[0].line, 6);
  assert.equal(by("no-trailing-newline").length, 1);
  assert.equal(by("orphan-parent")[0].line, 7);
  assert.equal(by("external-output").length, 1);
  assert.equal(by("bare-error")[0].line, 5);
  assert.equal(by("no-integrity").length, 1);
});

test("用户 ! 命令的 fullOutputPath 也算外部输出", () => {
  const text = [
    JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "t", cwd: "/" }),
    JSON.stringify({ type: "message", id: "a", parentId: null, timestamp: "t", message: { role: "bashExecution", command: "make", output: "…", exitCode: 0, cancelled: false, truncated: true, fullOutputPath: "/tmp/pi-bash-9.log" } }),
    "",
  ].join("\n");
  assert.deepEqual(inspectSession(text).facts.externalOutputs, ["/tmp/pi-bash-9.log"]);
});

test("旧版本会话：提醒打开时会被原地重写", () => {
  const text = `${JSON.stringify({ type: "session", id: "s", timestamp: "t", cwd: "/" })}\n`;
  assert.ok(rules(text).includes("old-version"));
});

test("第一条不是会话头：错误", () => {
  const text = `${JSON.stringify({ type: "message", id: "a", parentId: null })}\n`;
  assert.equal(inspectSession(text).findings.find((f) => f.rule === "no-header")?.severity, "error");
});

test("工具报错但 details 有内容：不当成分不清的报错", () => {
  const text = [
    JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "t", cwd: "/" }),
    JSON.stringify({ type: "message", id: "a", parentId: null, timestamp: "t", message: { role: "toolResult", toolCallId: "c", toolName: "bash", content: [], details: { exitCode: 1 }, isError: true } }),
    "",
  ].join("\n");
  assert.ok(!rules(text).includes("bare-error"));
});

test("空文件不报末行无换行", () => {
  assert.ok(!rules("").includes("no-trailing-newline"));
});
