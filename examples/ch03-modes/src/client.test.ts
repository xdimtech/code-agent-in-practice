import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { explain, runTurn } from "./client.ts";
import { takeLinesGeneric } from "./jsonl.ts";

// 真起子进程：src/fake-agent.ts 扮演 `pi --mode rpc`

const args = ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "fake-agent.ts")];
const opts = { command: process.execPath, args, timeoutMs: 5000 };

test("普通 prompt：收到响应和 agent_settled，没有问题", async () => {
  const r = await runTurn({ type: "prompt", message: "你好" }, { ...opts, policy: "cancel" });
  assert.equal(r.outcome, "settled");
  assert.deepEqual(r.state.problems, []);
  assert.equal(r.state.pending.size, 0);
  assert.match(explain(r), /跑完了/);
});

test("通用分行器：同一个子进程，U+2028 那一行被切坏", async () => {
  const r = await runTurn({ type: "prompt", message: "你好" }, { ...opts, policy: "cancel", split: takeLinesGeneric });
  assert.equal(r.outcome, "settled");
  assert.ok(r.state.problems.length >= 2);
  assert.ok(r.state.problems.every((p) => p.startsWith("不是 JSON")));
});

test("没有超时的确认框：自动取消就能收尾", async () => {
  const r = await runTurn({ type: "prompt", message: "请 confirm" }, { ...opts, policy: "cancel" });
  assert.equal(r.outcome, "settled");
  assert.ok(r.lines.some((l) => l.includes("用户取消了")));
});

test("没有超时的确认框：宿主不回就一直等到超时", async () => {
  const r = await runTurn({ type: "prompt", message: "请 confirm" }, { ...opts, policy: "ignore", timeoutMs: 800 });
  assert.equal(r.outcome, "timeout");
  assert.equal(r.state.settled, 0);
  assert.match(explain(r), /confirm\(ui_1\)/);
});

test("不认识的命令：错误响应记成问题，子进程不退出", async () => {
  const r = await runTurn({ type: "no_such_command" }, { ...opts, policy: "cancel", timeoutMs: 800 });
  assert.equal(r.outcome, "timeout");
  assert.deepEqual(r.state.problems, ["no_such_command 失败：Unknown command: no_such_command"]);
  assert.match(explain(r), /没有收到 agent_settled/);
});

test("子进程先退了", async () => {
  const r = await runTurn({ type: "prompt", message: "x" }, { command: process.execPath, args: ["-e", "process.exit(5)"], policy: "cancel", timeoutMs: 5000 });
  assert.equal(r.outcome, "exited");
  assert.match(explain(r), /子进程先退了/);
});

test("一行超过上限还没换行：按协议错误处理", async () => {
  const flood = ["-e", "process.stdout.write('x'.repeat(3 * 1024 * 1024)); setInterval(() => {}, 1000)"];
  const r = await runTurn({ type: "prompt", message: "x" }, { command: process.execPath, args: flood, policy: "cancel", timeoutMs: 5000 });
  assert.equal(r.outcome, "oversize");
  assert.match(explain(r), /超过上限/);
});
