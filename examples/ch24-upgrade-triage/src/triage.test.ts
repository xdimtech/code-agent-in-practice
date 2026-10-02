import assert from "node:assert/strict";
import { test } from "node:test";
import { detectMoves, needsHuman, relocate, relocatePrefix, tally, triage } from "./triage.ts";
import type { Manifest } from "./types.ts";

const m = (o: Record<string, string>): Manifest => new Map(Object.entries(o));
const states = (base: Manifest, ours: Manifest, next: Manifest): Record<string, string> =>
  Object.fromEntries(triage(base, ours, next).map((f) => [f.path, f.state]));

test("十二种处境各一个", () => {
  const base = m({ a: "1", b: "1", c: "1", d: "1", e: "1", f: "1", g: "1", h: "1", i: "1", j: "1" });
  const ours = m({ a: "1", b: "1", c: "2", d: "2", e: "2", f: "1", g: "2", k: "9", m: "5", n: "5" });
  const next = m({ a: "1", b: "2", c: "1", d: "2", e: "3", h: "1", i: "2", l: "9", m: "5", n: "6" });
  assert.deepEqual(states(base, ours, next), {
    a: "untouched",
    b: "take-upstream",
    c: "keep-ours",
    d: "same-change",
    e: "conflict",
    f: "upstream-deleted",
    g: "deleted-but-ours-modified",
    h: "ours-deleted",
    i: "ours-deleted-upstream-changed",
    j: "both-deleted",
    k: "ours-added",
    l: "upstream-added",
    m: "same-change",
    n: "conflict",
  });
});

test("需要人看的只有三种", () => {
  const files = triage(m({ a: "1", b: "1", c: "1", d: "1" }), m({ a: "2", b: "2", d: "1" }), m({ a: "3", c: "2", d: "2" }));
  assert.deepEqual(needsHuman(files).map((f) => `${f.path}:${f.state}`), [
    "a:conflict",
    "b:deleted-but-ours-modified",
    "c:ours-deleted-upstream-changed",
  ]);
  assert.equal(tally(files).get("take-upstream"), 1);
});

test("原样挪走的文件能找回来；挪完又改过的找不回来", () => {
  const base = m({ "src/a.ts": "A", "src/b.ts": "B", "src/c.ts": "C" });
  const ours = m({ "lib/a.ts": "A", "lib/b.ts": "B2", "src/c.ts": "C" });
  assert.deepEqual(detectMoves(base, ours), [{ from: "src/a.ts", to: "lib/a.ts" }]);
  const next = m({ "src/a.ts": "A9", "src/b.ts": "B9", "src/c.ts": "C" });
  assert.equal(states(base, ours, next)["src/a.ts"], "ours-deleted-upstream-changed");
  const fixed = states(base, relocate(ours, detectMoves(base, ours)), next);
  assert.equal(fixed["src/a.ts"], "take-upstream");
  assert.equal(fixed["src/b.ts"], "ours-deleted-upstream-changed");
  assert.equal(fixed["lib/a.ts"], undefined);
});

test("摘要不唯一时不猜", () => {
  const base = m({ "a/index.ts": "E", "b/index.ts": "E" });
  const ours = m({ "x/index.ts": "E", "y/index.ts": "E" });
  assert.deepEqual(detectMoves(base, ours), []);
});

test("目录改名按边界匹配", () => {
  const ours = m({ "providers/src/x.ts": "1", "providers-extra/y.ts": "2", "agent/z.ts": "3" });
  assert.deepEqual([...relocatePrefix(ours, [{ from: "ai", to: "providers" }]).keys()], ["ai/src/x.ts", "providers-extra/y.ts", "agent/z.ts"]);
});

test("不改传进来的清单", () => {
  const ours = m({ "lib/a.ts": "A" });
  relocate(ours, [{ from: "src/a.ts", to: "lib/a.ts" }]);
  assert.deepEqual([...ours.keys()], ["lib/a.ts"]);
});
