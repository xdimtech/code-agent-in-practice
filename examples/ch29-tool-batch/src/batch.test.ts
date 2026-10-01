import { test } from "node:test";
import assert from "node:assert/strict";
import { runBatch, SKIPPED_REASON, type BatchEvent, type Tool, type ToolCall } from "./batch.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const call = (id: string, name: string, args: Record<string, unknown> = {}): ToolCall => ({ id, name, args });

const wait: Tool = {
  name: "wait",
  execute: async (args) => {
    await sleep(Number(args.ms));
    return { text: `waited ${String(args.ms)}` };
  },
};

test("结果按调用顺序落盘，end 事件按完成顺序", async () => {
  const events: BatchEvent[] = [];
  const out = await runBatch([call("slow", "wait", { ms: 30 }), call("fast", "wait", { ms: 1 })], [wait], {
    emit: (e) => events.push(e),
  });
  assert.deepEqual(out.results.map((r) => r.toolCallId), ["slow", "fast"]);
  const ends = events.filter((e) => e.type === "end").map((e) => e.toolCallId);
  assert.deepEqual(ends, ["fast", "slow"]);
});

test("未知工具、被拦截、抛异常都变成 isError 结果，其余照常执行", async () => {
  const boom: Tool = { name: "boom", execute: async () => { throw new Error("磁盘满"); } };
  const out = await runBatch(
    [call("a", "nope"), call("b", "wait", { ms: 1 }), call("c", "boom"), call("d", "wait", { ms: 1 })],
    [wait, boom],
    { beforeCall: async (c) => (c.id === "d" ? { block: true, reason: "未授权" } : undefined) },
  );
  assert.deepEqual(out.results.map((r) => [r.toolCallId, r.isError, r.text]), [
    ["a", true, "未知工具：nope"],
    ["b", false, "waited 1"],
    ["c", true, "磁盘满"],
    ["d", true, "未授权"],
  ]);
});

test("提前终止需要全票", async () => {
  const done: Tool = { name: "done", execute: async () => ({ text: "ok", terminate: true }) };
  const one = await runBatch([call("a", "done"), call("b", "wait", { ms: 1 })], [done, wait]);
  assert.equal(one.terminate, false);
  const all = await runBatch([call("a", "done"), call("b", "done")], [done]);
  assert.equal(all.terminate, true);
  const empty = await runBatch([], [done]);
  assert.equal(empty.terminate, false);
});

test("一个 sequential 工具让整批退回串行", async () => {
  let inFlight = 0;
  let peak = 0;
  const tracked = (name: string, sequential: boolean): Tool => ({
    name,
    sequential,
    execute: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
      return { text: name };
    },
  });
  await runBatch([call("a", "p"), call("b", "p")], [tracked("p", false)]);
  assert.equal(peak, 2);
  peak = 0;
  await runBatch([call("a", "p"), call("b", "s")], [tracked("p", false), tracked("s", true)]);
  assert.equal(peak, 1);
});

test("准备阶段中止：每个调用仍然恰好有一条结果", async () => {
  const controller = new AbortController();
  const out = await runBatch([call("a", "wait", { ms: 1 }), call("b", "wait", { ms: 1 }), call("c", "wait", { ms: 1 })], [wait], {
    signal: controller.signal,
    beforeCall: async (c) => {
      if (c.id === "b") controller.abort();
      return undefined;
    },
  });
  assert.deepEqual(out.results.map((r) => r.toolCallId), ["a", "b", "c"]);
  assert.ok(out.results.every((r) => r.isError && r.text === SKIPPED_REASON));
});
