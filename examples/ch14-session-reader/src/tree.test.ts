import assert from "node:assert/strict";
import { test } from "node:test";
import { assistant, compaction, result, user } from "./fixtures.ts";
import { buildTree, contextEntries, pathTo } from "./tree.ts";

const ids = (es: readonly { id: string }[]) => es.map((e) => e.id);

test("叶子是文件最后一条，不是最长的那条路", () => {
  const t = buildTree([user("a", null), user("b", "a"), user("c", "b"), user("x", "a")]);
  assert.equal(t.leafId, "x");
  assert.deepEqual(ids(t.activePath), ["a", "x"]);
  assert.deepEqual(ids(t.offPath), ["b", "c"]);
  assert.deepEqual(t.abandonedLeaves, ["c"]);
});

test("空文件：没有叶子", () => {
  const t = buildTree([]);
  assert.equal(t.leafId, undefined);
  assert.deepEqual(t.activePath, []);
});

test("压缩：上下文 = 摘要 + 保留的尾巴 + 之后的条目", () => {
  const path = [user("a", null), user("b", "a"), user("c", "b"), compaction("k", "c", "b"), user("d", "k")];
  assert.deepEqual(ids(contextEntries(path)), ["k", "b", "c", "d"]);
});

test("多次压缩只认最后一次", () => {
  const path = [user("a", null), compaction("k1", "a", "a"), user("b", "k1"), compaction("k2", "b", "b"), user("c", "k2")];
  assert.deepEqual(ids(contextEntries(path)), ["k2", "b", "c"]);
});

test("firstKeptEntryId 找不到：只剩摘要和之后的", () => {
  assert.deepEqual(ids(contextEntries([user("a", null), compaction("k", "a", "zz"), user("b", "k")])), ["k", "b"]);
});

test("重复 id：后写覆盖先写，并报出来", () => {
  const t = buildTree([user("a", null), user("a", null, "second")]);
  assert.deepEqual(t.duplicateIds, ["a"]);
  assert.equal(t.byId.get("a")!.message!.content, "second");
});

test("父条目不存在：当作根，报悬空", () => {
  const t = buildTree([user("a", null), user("b", "gone")]);
  assert.deepEqual(ids(t.activePath), ["b"]);
  assert.deepEqual(t.danglingParents, [{ id: "b", parentId: "gone" }]);
});

test("parentId 成环：不卡死，报出环", () => {
  const t = buildTree([user("a", "b"), user("b", "a")]);
  assert.equal(t.cycleAt, "b");
  assert.deepEqual(ids(t.activePath), ["a", "b"]);
});

test("pathTo 能从根读到任一条目", () => {
  const t = buildTree([user("a", null), assistant("b", "a"), result("c", "b", "t1"), user("d", "a")]);
  assert.deepEqual(ids(pathTo(t, "c")), ["a", "b", "c"]);
  assert.deepEqual(pathTo(t, "nope"), []);
});
