import assert from "node:assert/strict";
import { test } from "node:test";
import { batchMode, runBatch, type HostEvent } from "./host.ts";
import { text, type ToolDef } from "./types.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tool(name: string, opts: Partial<ToolDef> & { run?: ToolDef["execute"] } = {}): ToolDef {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: { n: { type: "integer" } } },
    ...opts,
    execute: opts.run ?? (async () => ({ content: text(`${name} ok`), details: { from: name } })),
  };
}

const call = (id: string, name: string, args: unknown = {}) => ({ id, name, arguments: args });

test("找不到工具：错误结果，不抛", async () => {
  const r = await runBatch({ tools: [], calls: [call("1", "nope")] });
  assert.deepEqual(r.messages[0], { role: "toolResult", toolCallId: "1", toolName: "nope", content: text("Tool nope not found"), details: {}, isError: true });
});

test("抛错 → isError true；返回值里写什么都是 isError false", async () => {
  const thrower = tool("t", { run: async () => { throw new Error("boom"); } });
  const returner = tool("r", { run: async () => ({ content: text("Error: boom"), details: { isError: true, ok: false } }) });
  const r = await runBatch({ tools: [thrower, returner], calls: [call("1", "t"), call("2", "r")] });
  assert.deepEqual(r.messages.map((m) => [m.isError, m.content[0].text]), [[true, "boom"], [false, "Error: boom"]]);
  assert.deepEqual(r.messages[0].details, {});
});

test("抛的不是 Error 也接住", async () => {
  const r = await runBatch({ tools: [tool("t", { run: async () => { throw "plain"; } })], calls: [call("1", "t")] });
  assert.equal(r.messages[0].content[0].text, "plain");
});

test("prepareArguments 先于校验；校验失败不执行", async () => {
  let ran = 0;
  const t = tool("t", { prepareArguments: (a) => ({ n: (a as { count: unknown }).count }), run: async (_i, p) => { ran++; return { content: text(String((p as { n: number }).n)), details: {} }; } });
  const ok = await runBatch({ tools: [t], calls: [call("1", "t", { count: "7" })] });
  assert.equal(ok.messages[0].content[0].text, "7");
  const bad = await runBatch({ tools: [t], calls: [call("2", "t", { count: "x" })] });
  assert.equal(bad.messages[0].isError, true);
  assert.match(bad.messages[0].content[0].text, /^Validation failed for tool "t":\n {2}- n: must be integer/);
  assert.equal(ran, 1);
});

test("prepareArguments 抛错也变成错误结果", async () => {
  const t = tool("t", { prepareArguments: () => { throw new Error("shim broke"); } });
  const r = await runBatch({ tools: [t], calls: [call("1", "t")] });
  assert.deepEqual([r.messages[0].isError, r.messages[0].content[0].text], [true, "shim broke"]);
});

test("beforeToolCall 拦下：默认理由、自定义理由、terminate 带过去", async () => {
  let ran = 0;
  const t = tool("t", { run: async () => { ran++; return { content: text("x"), details: {} }; } });
  const r = await runBatch({
    tools: [t],
    calls: [call("1", "t"), call("2", "t")],
    hooks: { beforeToolCall: (c) => (c.id === "1" ? { block: true } : { block: true, reason: "no", terminate: true }) },
  });
  assert.deepEqual(r.messages.map((m) => m.content[0].text), ["Tool execution was blocked", "no"]);
  assert.equal(ran, 0);
  assert.equal(r.terminate, false, "只有一个要求 terminate");
});

test("beforeToolCall 拿到的是校验、转换之后的参数", async () => {
  let seen: unknown;
  await runBatch({ tools: [tool("t")], calls: [call("1", "t", { n: "3" })], hooks: { beforeToolCall: (_c, a) => void (seen = a) } });
  assert.deepEqual(seen, { n: 3 });
});

test("beforeToolCall 抛错：当作错误结果，工具不执行", async () => {
  const r = await runBatch({ tools: [tool("t")], calls: [call("1", "t")], hooks: { beforeToolCall: () => { throw new Error("hook"); } } });
  assert.deepEqual([r.messages[0].isError, r.messages[0].content[0].text], [true, "hook"]);
});

test("afterToolCall 逐字段覆盖；可以把成功改成失败", async () => {
  const r = await runBatch({
    tools: [tool("t")],
    calls: [call("1", "t")],
    hooks: { afterToolCall: () => ({ isError: true, content: text("redacted") }) },
  });
  assert.deepEqual(r.messages[0], { role: "toolResult", toolCallId: "1", toolName: "t", content: text("redacted"), details: { from: "t" }, isError: true });
});

test("afterToolCall 抛错：结果换成错误", async () => {
  const r = await runBatch({ tools: [tool("t")], calls: [call("1", "t")], hooks: { afterToolCall: () => { throw new Error("after"); } } });
  assert.deepEqual([r.messages[0].isError, r.messages[0].content[0].text, r.messages[0].details], [true, "after", {}]);
});

test("onUpdate：执行中转成事件，结束后再调被忽略", async () => {
  let late: ((p: { content: readonly { type: "text"; text: string }[]; details: unknown }) => void) | undefined;
  const t = tool("t", { run: async (_i, _p, _s, onUpdate) => { onUpdate?.({ content: text("50%"), details: {} }); late = onUpdate; return { content: text("done"), details: {} }; } });
  const events: HostEvent[] = [];
  await runBatch({ tools: [t], calls: [call("1", "t")], emit: (e) => void events.push(e) });
  late?.({ content: text("too late"), details: {} });
  assert.deepEqual(events.filter((e) => e.type === "tool_execution_update").length, 1);
});

test("并行：一起执行，结束事件按完成顺序，结果消息按原顺序", async () => {
  const slow = tool("slow", { run: async () => { await wait(30); return { content: text("slow"), details: {} }; } });
  const fast = tool("fast", { run: async () => { await wait(1); return { content: text("fast"), details: {} }; } });
  const events: string[] = [];
  const r = await runBatch({ tools: [slow, fast], calls: [call("s", "slow"), call("f", "fast")], emit: (e) => void events.push(`${e.type}:${e.id}`) });
  assert.equal(r.mode, "parallel");
  assert.deepEqual(events, [
    "tool_execution_start:s", "tool_execution_start:f",
    "tool_execution_end:f", "tool_execution_end:s",
    "tool_result_message:s", "tool_result_message:f",
  ]);
  assert.deepEqual(r.messages.map((m) => m.toolCallId), ["s", "f"]);
});

test("并行时准备阶段仍按顺序：拦截钩子一次只跑一个", async () => {
  let inHook = 0;
  let maxInHook = 0;
  await runBatch({
    tools: [tool("t")],
    calls: [call("1", "t"), call("2", "t"), call("3", "t")],
    hooks: { beforeToolCall: async () => { inHook++; maxInHook = Math.max(maxInHook, inHook); await wait(2); inHook--; return undefined; } },
  });
  assert.equal(maxInHook, 1);
});

test("有一个工具声明 sequential，整批串行", async () => {
  const seq = tool("seq", { executionMode: "sequential" });
  assert.equal(batchMode([seq, tool("p")], [call("1", "p"), call("2", "seq")]), "sequential");
  assert.equal(batchMode([seq, tool("p")], [call("1", "p")]), "parallel");
  assert.equal(batchMode([tool("p")], [call("1", "p")], "sequential"), "sequential");
  const events: string[] = [];
  await runBatch({ tools: [seq, tool("p")], calls: [call("1", "p"), call("2", "seq")], emit: (e) => void events.push(`${e.type}:${e.id}`) });
  assert.deepEqual(events.slice(0, 3), ["tool_execution_start:1", "tool_execution_end:1", "tool_result_message:1"]);
});

test("terminate：每个结果都要求才算", async () => {
  const term = tool("term", { run: async () => ({ content: text("x"), details: {}, terminate: true }) });
  assert.equal((await runBatch({ tools: [term], calls: [call("1", "term"), call("2", "term")] })).terminate, true);
  assert.equal((await runBatch({ tools: [term, tool("t")], calls: [call("1", "term"), call("2", "t")] })).terminate, false);
  assert.equal((await runBatch({ tools: [term], calls: [] })).terminate, false);
});

test("已中止：拦截钩子之后不再执行，后面的调用不再准备", async () => {
  const ac = new AbortController();
  let ran = 0;
  const t = tool("t", { run: async () => { ran++; return { content: text("x"), details: {} }; } });
  const r = await runBatch({ tools: [t], calls: [call("1", "t"), call("2", "t")], signal: ac.signal, hooks: { beforeToolCall: () => void ac.abort() } });
  assert.equal(ran, 0);
  assert.deepEqual(r.messages.map((m) => m.content[0].text), ["Operation aborted"]);
});
