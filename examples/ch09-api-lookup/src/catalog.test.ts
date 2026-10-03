import assert from "node:assert/strict";
import { test } from "node:test";
import { API_GROUPS, canChange, eventInfo, EVENTS, eventsByStage, isEventName, STAGE_TITLES } from "./catalog.ts";
import { findTasks, TASKS } from "./tasks.ts";
import { EVENT_NAMES, MERGES, type Stage } from "./types.ts";

test("事件卡片正好覆盖 36 个事件，不多不少不重复", () => {
  assert.equal(EVENT_NAMES.length, 36);
  assert.equal(new Set(EVENT_NAMES).size, 36);
  assert.deepEqual([...EVENTS.map((e) => e.name)].sort(), [...EVENT_NAMES].sort());
});

test("每个阶段都有标题，每个事件都落在某个阶段里", () => {
  const total = (Object.keys(STAGE_TITLES) as Stage[]).reduce((n, s) => n + eventsByStage(s).length, 0);
  assert.equal(total, 36);
  for (const s of Object.keys(STAGE_TITLES) as Stage[]) assert.ok(eventsByStage(s).length > 0, s);
});

test("12 种合并方式都有事件在用", () => {
  for (const m of MERGES) assert.ok(EVENTS.some((e) => e.merge === m), m);
});

test("只有 notify 是只读的；能改的 15 个", () => {
  assert.equal(EVENTS.filter(canChange).length, 15);
  for (const e of EVENTS.filter((x) => !canChange(x))) assert.match(e.can, /只读/, e.name);
});

test("几个容易记错的合并方式", () => {
  assert.equal(eventInfo("tool_call")?.merge, "block");
  assert.equal(eventInfo("before_provider_headers")?.merge, "in-place");
  assert.equal(eventInfo("session_before_compact")?.merge, "cancel");
  assert.equal(eventInfo("tool_execution_start")?.merge, "notify");
  assert.equal(eventInfo("agent_settled")?.merge, "notify");
});

test("每个事件都写了触发位置，带行号", () => {
  for (const e of EVENTS) assert.match(e.emittedAt, /\.ts:\d+/, e.name);
});

test("isEventName：只认 36 个", () => {
  assert.ok(isEventName("tool_call"));
  assert.ok(!isEventName("auto_retry_start"));
  assert.ok(!isEventName(""));
  assert.equal(eventInfo("nope"), undefined);
});

test("API 分组 11 组，方法不重复", () => {
  assert.equal(API_GROUPS.length, 11);
  const methods = API_GROUPS.flatMap((g) => g.methods);
  assert.equal(new Set(methods).size, methods.length);
});

const API_METHODS = new Set(API_GROUPS.flatMap((g) => g.methods));
const mentions = (s: string) => EVENT_NAMES.some((n) => new RegExp(`\\b${n}\\b`).test(s)) || [...API_METHODS].some((m) => s.includes(m));

test("每个任务的首选都是一个真实的事件或 API", () => {
  assert.equal(new Set(TASKS.map((t) => t.id)).size, TASKS.length);
  for (const t of TASKS) assert.ok(mentions(t.use[0]), `${t.id}: ${t.use[0]}`);
});

test("findTasks：关键词、事件名、大小写", () => {
  assert.ok(findTasks("脱敏").some((t) => t.id === "rewrite-payload"));
  assert.ok(findTasks("TOOL_CALL").some((t) => t.id === "block-tool"));
  assert.ok(findTasks("agent_settled").some((t) => t.id === "after-run"));
  assert.deepEqual(findTasks("   "), []);
  assert.deepEqual(findTasks("完全不相关的词"), []);
});
