import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShortcuts, type Builtin } from "./shortcuts.ts";
import type { Extension } from "./types.ts";

const ext = (path: string, ...keys: string[]): Extension => ({
  path,
  handlers: [],
  tools: new Map(),
  shortcuts: keys.map((key) => ({ key, description: `${path}:${key}` })),
});

const BUILTINS: Builtin[] = [
  { key: "ctrl+c", action: "interrupt", reserved: true },
  { key: "ctrl+r", action: "history.search", reserved: false },
];

test("保留键：扩展的注册被跳过，留下警告", () => {
  const { shortcuts, warnings } = resolveShortcuts(BUILTINS, [ext("a.ts", "ctrl+c")]);
  assert.equal(shortcuts.size, 0);
  assert.match(warnings[0]!, /与保留键 interrupt 冲突，已跳过/);
});

test("非保留的内置键：扩展赢，留下警告", () => {
  const { shortcuts, warnings } = resolveShortcuts(BUILTINS, [ext("a.ts", "ctrl+r")]);
  assert.equal(shortcuts.get("ctrl+r")?.path, "a.ts");
  assert.match(warnings[0]!, /覆盖了内置键「ctrl\+r」/);
});

test("两个扩展抢同一个键：后加载的赢", () => {
  const { shortcuts, warnings } = resolveShortcuts(BUILTINS, [ext("a.ts", "ctrl+g"), ext("b.ts", "ctrl+g")]);
  assert.equal(shortcuts.get("ctrl+g")?.path, "b.ts");
  assert.deepEqual(warnings, ["「ctrl+g」同时被 a.ts 和 b.ts 注册，用后者"]);
});

test("没有冲突就没有警告", () => {
  const { shortcuts, warnings } = resolveShortcuts(BUILTINS, [ext("a.ts", "ctrl+g")]);
  assert.equal(shortcuts.size, 1);
  assert.deepEqual(warnings, []);
});
