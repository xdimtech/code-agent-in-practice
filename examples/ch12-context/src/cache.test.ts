import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_CACHE, serialize, simulate, summarize } from "./cache.ts";
import { runStrategy, STRATEGIES, envLine } from "./strategies.ts";
import { PROMPTS, TOOLS } from "./fixtures.ts";
import type { Request } from "./types.ts";

const req = (system: string, ...contents: readonly string[]): Request => ({
  tools: TOOLS,
  system,
  messages: contents.map((content, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), content })),
});

test("断点：最后一个工具、system、最后一条 user 消息；最后一条不是 user 就没有第三个", () => {
  assert.equal(serialize(req("S", "u1")).breakpoints.length, 3);
  assert.equal(serialize(req("S", "u1", "a1")).breakpoints.length, 2);
  assert.equal(serialize({ tools: [], system: "S", messages: [] }).breakpoints.length, 1);
});

test("第一次全不中；同样的请求再发一次全中", () => {
  const first = simulate(EMPTY_CACHE, req("S", "u1"));
  assert.equal(first.result.cachedTokens, 0);
  const again = simulate(first.cache, req("S", "u1"));
  assert.equal(again.result.cachedTokens, again.result.inputTokens);
});

test("历史只追加：上一轮的整段前缀都能命中", () => {
  const first = simulate(EMPTY_CACHE, req("S", "u1"));
  const second = simulate(first.cache, req("S", "u1", "a1", "u2"));
  assert.equal(second.result.cachedTokens, Math.ceil(serialize(req("S", "u1")).text.length / 4));
});

test("system 改一个字：只剩工具那一段命中", () => {
  const first = simulate(EMPTY_CACHE, req("S1", "u1"));
  const second = simulate(first.cache, req("S2", "u1", "a1", "u2"));
  const toolsOnly = serialize(req("S1")).breakpoints[0] ?? 0;
  assert.equal(second.result.cachedTokens, Math.ceil(toolsOnly / 4));
});

test("summarize：没有输入时命中率为 0", () => {
  assert.equal(summarize([]).hitRate, 0);
  assert.equal(summarize([{ inputTokens: 10, cachedTokens: 5 }]).hitRate, 0.5);
});

test("环境信息每 3 轮变一次", () => {
  assert.equal(envLine(3), envLine(1));
  assert.notEqual(envLine(4), envLine(3));
});

const scenario = { tools: TOOLS, baseSystemPrompt: "BASE ".repeat(400), prompts: PROMPTS };
const runs = Object.fromEntries(STRATEGIES.map((s) => [s.name, runStrategy(s, scenario)]));
const get = (name: string) => {
  const run = runs[name];
  assert.ok(run, name);
  return run;
};

test("快照进 system：缓存跟不注入一样好，但 9 轮里 6 轮看到的是旧值", () => {
  assert.equal(get("构建时快照进 system").hitRate.toFixed(3), get("不注入环境信息").hitRate.toFixed(3));
  assert.equal(get("构建时快照进 system").staleTurns, 6);
  assert.equal(get("不注入环境信息").staleTurns, PROMPTS.length);
});

test("每轮改 system：信息新鲜，但每次变化都让整段历史失效，命中率最低", () => {
  const run = get("每轮改 system prompt");
  assert.equal(run.staleTurns, 0);
  assert.ok(STRATEGIES.every((s) => get(s.name).hitRate >= run.hitRate));
});

test("持久消息：缓存不受影响，但每轮一条会越攒越多；变了才注入只留 3 条", () => {
  assert.equal(get("每轮注入持久消息").injectedInHistory, PROMPTS.length);
  assert.equal(get("变了才注入持久消息").injectedInHistory, 3);
  assert.ok(get("变了才注入持久消息").inputTokens < get("每轮注入持久消息").inputTokens);
  assert.ok(get("变了才注入持久消息").hitRate > get("context 钩子尾部注入").hitRate);
});

test("context 尾部注入：不进历史，但上一轮的尾巴消失，历史那段每轮都不中", () => {
  const run = get("context 钩子尾部注入");
  assert.equal(run.injectedInHistory, 0);
  assert.equal(run.staleTurns, 0);
  assert.ok(run.hitRate < get("变了才注入持久消息").hitRate);
});
