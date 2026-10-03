import assert from "node:assert/strict";
import { test } from "node:test";
import { choose, type Needs } from "./choose.ts";

const base: Needs = { viewer: "nobody", host: "other", turns: "one", events: false };

test("人在 pi 的终端里：interactive，不管别的", () => {
  assert.equal(choose({ ...base, viewer: "pi-terminal", host: "node", turns: "many" }).form, "interactive");
});

test("Node 宿主 + 自己的界面：sdk", () => {
  assert.equal(choose({ ...base, viewer: "own-ui", host: "node", turns: "many", events: true }).form, "sdk");
});

test("一次一问：要过程选 json，只要答案选 print", () => {
  assert.equal(choose({ ...base, events: true }).form, "json");
  assert.equal(choose(base).form, "print");
});

test("多轮，或者非 Node 宿主的自有界面：rpc", () => {
  assert.equal(choose({ ...base, turns: "many" }).form, "rpc");
  assert.equal(choose({ ...base, viewer: "own-ui", turns: "many" }).form, "rpc");
});

test("Node 宿主但没人看界面：不走 sdk", () => {
  assert.equal(choose({ ...base, host: "node", turns: "many" }).form, "rpc");
});

test("每个选择都写明代价", () => {
  const all: Needs[] = [
    { ...base, viewer: "pi-terminal" },
    { ...base, viewer: "own-ui", host: "node" },
    { ...base, events: true },
    base,
    { ...base, turns: "many" },
  ];
  for (const n of all) assert.ok(choose(n).costs.length > 0, JSON.stringify(n));
});
