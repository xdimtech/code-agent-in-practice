import assert from "node:assert/strict";
import { test } from "node:test";
import { hasFailure, parseProblem, parseVersion, runChecks, stripJsonComments, versionAtLeast, type Probe } from "./doctor.ts";

const healthy: Probe = {
  platform: "darwin",
  nodeVersion: "v22.19.0",
  env: {},
  agentDir: "/h/.pi/agent",
  agentDirExists: true,
  auth: { exists: true, mode: 0o600 },
  models: { exists: false },
  settings: { exists: true, text: '{ "theme": "dark" }' },
  sessionsDir: { exists: true, mode: 0o700 },
  debugLog: { exists: false },
  crashLog: { exists: false },
};
const statusOf = (p: Probe, name: string) => runChecks(p).find((c) => c.name === name)?.status;

test("版本号比较", () => {
  assert.deepEqual(parseVersion("v22.19.0"), [22, 19, 0]);
  assert.equal(parseVersion("banana"), undefined);
  assert.ok(versionAtLeast([22, 19, 0], [22, 19, 0]));
  assert.ok(versionAtLeast([23, 0, 0], [22, 19, 0]));
  assert.ok(!versionAtLeast([22, 9, 9], [22, 19, 0]));
});

test("去注释和尾逗号，字符串里的 // 不动", () => {
  const src = '{\n  // 注释\n  "url": "http://x//y", // 行尾\n  "list": [1, 2,],\n}';
  assert.deepEqual(JSON.parse(stripJsonComments(src)), { url: "http://x//y", list: [1, 2] });
});

test("解析失败只报行列，不回显内容", () => {
  const secret = ["sk", "zzzzzzzzzzzzzzzzzzzz"].join("-");
  const problem = parseProblem(`{\n  "apiKey": ${secret}\n}`)!;
  assert.match(problem, /^第 2 行第 \d+ 列$/);
  assert.equal(parseProblem("{}"), undefined);
});

test("健康的环境全部通过", () => {
  const checks = runChecks(healthy);
  assert.ok(checks.every((c) => c.status === "通过"), JSON.stringify(checks));
  assert.ok(!hasFailure(checks));
});

test("Node 太旧、看不懂版本号都算失败", () => {
  assert.equal(statusOf({ ...healthy, nodeVersion: "v22.12.0" }, "Node 版本"), "失败");
  assert.equal(statusOf({ ...healthy, nodeVersion: "nightly" }, "Node 版本"), "失败");
});

test("配置目录不存在：显式指定的算失败，缺省位置只是注意", () => {
  assert.equal(statusOf({ ...healthy, agentDirExists: false }, "配置目录"), "注意");
  assert.equal(statusOf({ ...healthy, agentDirExists: false, env: { PI_CODING_AGENT_DIR: "/typo" } }, "配置目录"), "失败");
});

test("auth.json 别人能读算失败；Windows 不看权限位", () => {
  assert.equal(statusOf({ ...healthy, auth: { exists: true, mode: 0o644 } }, "auth.json"), "失败");
  assert.equal(statusOf({ ...healthy, platform: "win32", auth: { exists: true, mode: 0o666 } }, "auth.json"), "通过");
  assert.equal(statusOf({ ...healthy, auth: { exists: false } }, "auth.json"), "注意");
});

test("models.json 允许注释和尾逗号，settings.json 不允许", () => {
  const commented = '{\n  // c\n  "a": 1,\n}';
  assert.equal(statusOf({ ...healthy, models: { exists: true, text: commented } }, "models.json"), "通过");
  const settings = runChecks({ ...healthy, settings: { exists: true, text: commented } }).find((c) => c.name === "settings.json")!;
  assert.equal(settings.status, "失败");
  assert.match(settings.detail, /注释或尾逗号/);
  const broken = runChecks({ ...healthy, settings: { exists: true, text: '{"a":' } }).find((c) => c.name === "settings.json")!;
  assert.match(broken.detail, /^解析失败/);
  assert.equal(statusOf({ ...healthy, models: { exists: true, text: "﻿{}" } }, "models.json"), "通过");
});

test("遗留物：会话目录权限、调试日志、崩溃日志、开着的调试变量", () => {
  const p: Probe = {
    ...healthy,
    sessionsDir: { exists: true, mode: 0o755 },
    debugLog: { exists: true, size: 10 },
    crashLog: { exists: true, size: 20 },
    env: { PI_TIMING: "true", PI_TUI_WRITE_LOG: "/tmp/w.log" },
  };
  const names = runChecks(p).filter((c) => c.status === "注意").map((c) => c.name);
  assert.deepEqual(names, ["会话目录", "pi-debug.log", "pi-crash.log", "PI_TIMING", "PI_TUI_WRITE_LOG"]);
  assert.ok(!hasFailure(runChecks(p)));
});

test("出错位置：带 position 的和不带的报错都能定位", () => {
  assert.equal(parseProblem('{"a":1,}'), "第 1 行第 8 列");
  assert.equal(parseProblem('{\n  "k": oops\n}'), "第 2 行第 8 列");
  assert.equal(parseProblem(""), "第 1 行第 1 列");
  assert.equal(parseProblem('{\n  "a": 1'), "第 2 行第 9 列");
});
