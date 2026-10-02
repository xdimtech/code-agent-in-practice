import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnose, hasBlocking, REPEAT_THRESHOLD } from "./diagnose.ts";
import { assistant, compaction, HEADER, jsonl, result, user } from "./fixtures.ts";
import { parseSession } from "./jsonl.ts";
import { buildTree } from "./tree.ts";

const run = (text: string) => {
  const parsed = parseSession(text);
  return diagnose(parsed, buildTree(parsed.entries));
};
const codes = (text: string) => run(text).map((f) => f.code);
const call = (id: string, args: Record<string, unknown> = { command: "npm test" }) => ({ calls: [{ id, name: "bash", args }] });

test("干净的会话：没有发现", () => {
  const fs = run(jsonl(HEADER, user("a", null), assistant("b", "a", call("t1")), result("c", "b", "t1"), assistant("d", "c")));
  assert.deepEqual(fs, []);
  assert.equal(hasBlocking(fs), false);
});

test("结构问题都是高", () => {
  const text = jsonl(HEADER, user("a", null), "{bad", user("a", null), user("b", "gone"));
  const fs = run(text);
  assert.deepEqual(fs.filter((f) => f.severity === "高").map((f) => f.code), ["line:malformed-json", "tree:duplicate-id", "tree:dangling-parent"]);
  assert.equal(hasBlocking(fs), true);
});

test("成环：高", () => assert.ok(codes(jsonl(HEADER, user("a", "b"), user("b", "a"))).includes("tree:cycle")));

test("旧版本、末行缺换行：提示", () => {
  const { version: _v, ...v1 } = HEADER;
  const fs = run(JSON.stringify(v1) + "\n" + JSON.stringify(user("a", null)));
  assert.deepEqual(fs.map((f) => [f.severity, f.code]), [["提示", "file:migration"], ["提示", "file:no-newline"]]);
});

test("stopReason：error/aborted 高，length 中，路由提示", () => {
  const fs = run(
    jsonl(
      HEADER,
      user("a", null),
      assistant("b", "a", { stopReason: "error", errorMessage: "429" }),
      assistant("c", "b", { stopReason: "aborted" }),
      assistant("d", "c", { stopReason: "length" }),
      assistant("e", "d", { model: "auto", responseModel: "real" }),
    ),
  );
  assert.deepEqual(fs.map((f) => [f.severity, f.code, f.entryId]), [
    ["高", "stop:error", "b"],
    ["高", "stop:aborted", "c"],
    ["中", "stop:length", "d"],
    ["提示", "model:routed", "e"],
  ]);
  assert.match(fs[0]!.message, /429/);
  assert.match(fs[1]!.message, /没有 errorMessage/);
});

test("工具：没结果是高，报错是中", () => {
  const fs = run(jsonl(HEADER, user("a", null), assistant("b", "a", call("t1")), result("c", "b", "t1", true), assistant("d", "c", call("t2"))));
  assert.deepEqual(fs.map((f) => [f.severity, f.code, f.entryId]), [["高", "tool:orphan-call", "d"], ["中", "tool:error", "b"]]);
});

test(`同样的调用第 ${REPEAT_THRESHOLD} 次：中间隔着别的调用也算`, () => {
  const rows = [HEADER, user("a", null)];
  let parent = "a";
  for (let i = 0; i < REPEAT_THRESHOLD; i++) {
    rows.push(assistant(`x${i}`, parent, call(`t${i}`)), result(`r${i}`, `x${i}`, `t${i}`));
    rows.push(assistant(`y${i}`, `r${i}`, call(`u${i}`, { path: `f${i}` })), result(`s${i}`, `y${i}`, `u${i}`));
    parent = `s${i}`;
  }
  const repeat = run(jsonl(...rows)).filter((f) => f.code === "tool:repeat");
  assert.equal(repeat.length, 1);
  assert.equal(repeat[0]!.entryId, `x${REPEAT_THRESHOLD - 1}`);
  assert.match(repeat[0]!.message, /第一次在 x0/);
});

test("被放弃的分支：照样诊断，降一级并标出来；共享的前缀不重复报", () => {
  const fs = run(
    jsonl(
      HEADER,
      user("a", null),
      assistant("b", "a", call("t1")),
      result("c", "b", "t1", true),
      assistant("dead", "c", { stopReason: "error", errorMessage: "429" }),
      user("d", "c"),
    ),
  );
  const abandoned = fs.filter((f) => f.message.startsWith("［已放弃的分支］"));
  assert.deepEqual(abandoned.map((f) => [f.severity, f.code, f.entryId]), [["中", "stop:error", "dead"]]);
  assert.equal(fs.filter((f) => f.code === "tool:error").length, 1);
  assert.ok(fs.some((f) => f.code === "tree:off-path"));
});

test("压缩：提示有几条模型看不到", () => {
  const fs = run(jsonl(HEADER, user("a", null), user("b", "a"), compaction("k", "b", "b"), user("c", "k")));
  const f = fs.find((x) => x.code === "context:compacted")!;
  assert.match(f.message, /1 个条目/);
});

test("同级保持出现顺序，高排在最前", () => {
  const fs = run(jsonl(HEADER, user("a", null), assistant("b", "a", { model: "auto", responseModel: "r" }), "{bad"));
  assert.deepEqual(fs.map((f) => f.severity), ["高", "提示"]);
});
