import assert from "node:assert/strict";
import { test } from "node:test";
import { agentDir, checkEnv, DEBUG_VARS, isActive } from "./debug-vars.ts";

test("七个变量，名字不重复，都有出处", () => {
  assert.equal(DEBUG_VARS.length, 7);
  assert.equal(new Set(DEBUG_VARS.map((v) => v.name)).size, 7);
  assert.ok(DEBUG_VARS.every((v) => /\.ts:\d+/.test(v.source)));
});

test("三种生效规则各不相同", () => {
  assert.equal(isActive("等于 1", "1"), true);
  assert.equal(isActive("等于 1", "true"), false);
  assert.equal(isActive("等于 1", " 1"), false);
  assert.equal(isActive("1/true/yes", "YES"), true);
  assert.equal(isActive("1/true/yes", "on"), false);
  assert.equal(isActive("非空", "0"), true);
  assert.equal(isActive("非空", "  "), false);
  for (const a of ["等于 1", "1/true/yes", "非空"] as const) assert.equal(isActive(a, undefined), false);
});

test("checkEnv 只看这七个，不回显别的环境变量", () => {
  const secret = "s" + "k-" + "x".repeat(20);
  const out = checkEnv({ PI_TIMING: "1", OPENAI_API_KEY: secret, HOME: "/h" });
  assert.deepEqual(out.map((c) => c.name), ["PI_TIMING"]);
  assert.ok(!JSON.stringify(out).includes(secret));
});

test("不生效时说清楚要什么值", () => {
  const [c] = checkEnv({ PI_TIMING: "true" });
  assert.equal(c!.active, false);
  assert.match(c!.notes[0]!, /「等于 1」/);
});

test("生效时的提醒：落盘、撞文件、每帧一个文件、改行为", () => {
  const notes = Object.fromEntries(
    checkEnv({ PI_TUI_WRITE_LOG: "/tmp/x", PI_DEBUG_REDRAW: "1", PI_TUI_DEBUG: "1", PI_EXPERIMENTAL: "1", PI_STARTUP_BENCHMARK: "1" }).map((c) => [c.name, c.notes.join("|")]),
  );
  assert.match(notes.PI_TUI_WRITE_LOG!, /落盘/);
  assert.match(notes.PI_DEBUG_REDRAW!, /\/debug/);
  assert.match(notes.PI_TUI_DEBUG!, /落盘.*\|.*每帧/);
  assert.match(notes.PI_EXPERIMENTAL!, /改变行为/);
  assert.equal(notes.PI_STARTUP_BENCHMARK, "");
});

test("日志目录：PI_CODING_AGENT_DIR 优先，空串当没设", () => {
  assert.equal(agentDir({}, "/h"), "/h/.pi/agent");
  assert.equal(agentDir({ PI_CODING_AGENT_DIR: "/d" }, "/h"), "/d");
  assert.equal(agentDir({ PI_CODING_AGENT_DIR: "" }, "/h"), "/h/.pi/agent");
});
