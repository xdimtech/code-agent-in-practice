import { test } from "node:test";
import assert from "node:assert/strict";
import { JournalCorruption, restore } from "./journal.ts";
import { drive, INTERRUPTED, MemoryStore, planBatch, type Tool } from "./recover.ts";

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** 一个会卡在副作用中间的工具：模拟进程在这里被杀 */
function hanging(name: string, replay: Tool["replay"], counter: { runs: number }): Tool {
  return {
    name,
    replay,
    execute: () => {
      counter.runs++;
      return new Promise<string>(() => {});
    },
  };
}

function counting(name: string, replay: Tool["replay"], counter: { runs: number }): Tool {
  return {
    name,
    replay,
    execute: async () => {
      counter.runs++;
      return `${name} ok`;
    },
  };
}

/** 跑到第 0 个调用卡住，返回「崩溃那一刻」落盘的日志副本 */
async function crashDuringFirstCall(first: Tool, rest: Tool[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  planBatch(store, "b1", [
    { id: "c0", name: first.name, args: {} },
    { id: "c1", name: "read", args: {} },
  ]);
  void drive(store, [first, ...rest]);
  await tick();
  return new MemoryStore(store.read());
}

const results = (store: MemoryStore) =>
  restore(store.read())?.calls.map((c) => (c.status === "completed" ? [c.call.id, c.isError, c.text] : c.status));

test("replay=never：不重跑，在预留位置补「已中断」，然后继续下一个调用", async () => {
  const rm = { runs: 0 };
  const read = { runs: 0 };
  const store = await crashDuringFirstCall(hanging("rm", "never", rm), [counting("read", "safe", read)]);
  assert.deepEqual(results(store), ["effect_pending", "planned"]);

  await drive(store, [counting("rm", "never", rm), counting("read", "safe", read)]);
  assert.equal(rm.runs, 1, "rm 只在崩溃前执行过一次");
  assert.deepEqual(results(store), [
    ["c0", true, INTERRUPTED],
    ["c1", false, "read ok"],
  ]);
});

test("replay=safe：落盘声明与当前声明都是 safe 才重跑", async () => {
  const grep = { runs: 0 };
  const store = await crashDuringFirstCall(hanging("grep", "safe", grep), [counting("read", "safe", { runs: 0 })]);
  await drive(store, [counting("grep", "safe", grep), counting("read", "safe", { runs: 0 })]);
  assert.equal(grep.runs, 2);
  assert.deepEqual(results(store)?.[0], ["c0", false, "grep ok"]);
});

test("崩溃时声明 safe、升级后改成 never：按 never 处理", async () => {
  const grep = { runs: 0 };
  const store = await crashDuringFirstCall(hanging("grep", "safe", grep), [counting("read", "safe", { runs: 0 })]);
  await drive(store, [counting("grep", "never", grep), counting("read", "safe", { runs: 0 })]);
  assert.equal(grep.runs, 1);
  assert.deepEqual(results(store)?.[0], ["c0", true, INTERRUPTED]);
});

test("恢复是幂等的：已结算的调用不会再写第二次", async () => {
  const store = new MemoryStore();
  planBatch(store, "b1", [{ id: "c0", name: "read", args: {} }]);
  const read = { runs: 0 };
  await drive(store, [counting("read", "safe", read)]);
  const before = store.read().length;
  await drive(store, [counting("read", "safe", read)]);
  assert.equal(read.runs, 1);
  assert.equal(store.read().length, before);
});

test("日志损坏：拒绝恢复，一条记录都不写", async () => {
  const store = new MemoryStore();
  planBatch(store, "b1", [{ id: "c0", name: "read", args: {} }]);
  store.commit({ type: "tool_started", batchId: "b1", toolIndex: 0, toolCallId: "c0", replay: "safe" });
  store.commit({ type: "tool_started", batchId: "b1", toolIndex: 0, toolCallId: "c0", replay: "safe" });
  const before = store.read();
  await assert.rejects(drive(store, [counting("read", "safe", { runs: 0 })]), JournalCorruption);
  assert.deepEqual(store.read(), before);
});
