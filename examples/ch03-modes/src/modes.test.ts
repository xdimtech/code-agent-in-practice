import assert from "node:assert/strict";
import { test } from "node:test";
import { noUiAnswer, PROFILES, resolveAppMode, switchCost } from "./modes.ts";
import type { Form } from "./types.ts";

const both = { stdin: true, stdout: true };

test("resolveAppMode：--mode 优先于一切", () => {
  assert.equal(resolveAppMode({ mode: "rpc", print: true }, { stdin: false, stdout: false }), "rpc");
  assert.equal(resolveAppMode({ mode: "json" }, { stdin: false, stdout: true }), "json");
});

test("resolveAppMode：-p 或者任何一头不是终端都退成 print", () => {
  assert.equal(resolveAppMode({ print: true }, both), "print");
  assert.equal(resolveAppMode({}, { stdin: false, stdout: true }), "print");
  assert.equal(resolveAppMode({}, { stdin: true, stdout: false }), "print");
  assert.equal(resolveAppMode({ mode: "text" }, { stdin: true, stdout: false }), "print");
});

test("resolveAppMode：两头都是终端、没有参数才是 interactive", () => {
  assert.equal(resolveAppMode({}, both), "interactive");
  assert.equal(resolveAppMode({ mode: "text" }, both), "interactive");
});

test("PROFILES：扩展看到的 mode 和 hasUI", () => {
  const seen = (f: Form) => [PROFILES[f].extensionMode, PROFILES[f].hasUI];
  assert.deepEqual(seen("interactive"), ["tui", true]);
  assert.deepEqual(seen("print"), ["print", false]);
  assert.deepEqual(seen("json"), ["json", false]);
  assert.deepEqual(seen("rpc"), ["rpc", true]);
  assert.deepEqual(seen("sdk"), ["print", false]);
});

test("switchCost：同一种形态之间没有变化；对称", () => {
  assert.deepEqual(switchCost("rpc", "rpc"), []);
  const ab = switchCost("print", "json").map((c) => c.dimension);
  const ba = switchCost("json", "print").map((c) => c.dimension);
  assert.deepEqual(ab, ba);
});

test("switchCost：print → json 不动扩展看到的 hasUI，但改了失败的报法", () => {
  const dims = switchCost("print", "json").map((c) => c.dimension);
  assert.ok(dims.includes("失败怎么报"));
  assert.ok(!dims.includes("扩展看到的 ctx.hasUI"));
});

test("switchCost：print → rpc 连扩展行为都变了", () => {
  const c = switchCost("print", "rpc").find((x) => x.dimension === "扩展看到的 ctx.hasUI");
  assert.deepEqual(c && [c.from, c.to], ["false", "true"]);
});

test("noUiAnswer：没有 UI 时 confirm 是 false，其余 undefined", () => {
  assert.equal(noUiAnswer("confirm"), false);
  for (const m of ["select", "input", "editor"] as const) assert.equal(noUiAnswer(m), undefined);
});
