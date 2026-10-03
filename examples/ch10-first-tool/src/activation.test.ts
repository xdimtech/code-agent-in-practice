import assert from "node:assert/strict";
import { test } from "node:test";
import { activate, DEFAULT_ACTIVE, registerLater, type ToolMeta } from "./activation.ts";

const ext: ToolMeta[] = [
  { name: "find_text", promptSnippet: "Search text", promptGuidelines: ["Use find_text for search", "  "] },
  { name: "deploy" },
];

test("默认：四个内置 + 所有扩展工具；没有 promptSnippet 的不进 Available tools", () => {
  const a = activate({}, ext);
  assert.deepEqual(a.active, [...DEFAULT_ACTIVE, "find_text", "deploy"]);
  assert.deepEqual(a.listed, [...DEFAULT_ACTIVE, "find_text"]);
  assert.deepEqual(a.unlisted, ["deploy"]);
  assert.deepEqual(a.sources, { read: "builtin", bash: "builtin", edit: "builtin", write: "builtin", find_text: "extension", deploy: "extension" });
});

test("grep / find / ls 默认注册了但不激活", () => {
  assert.ok(!activate({}).active.includes("grep"));
  assert.deepEqual(activate({ tools: ["grep", "ls"] }).active, ["grep", "ls"]);
});

test("--no-builtin-tools：内置全关，扩展留着", () => {
  assert.deepEqual(activate({ noTools: "builtin" }, ext).active, ["find_text", "deploy"]);
});

test("--no-tools：全关，扩展也关", () => {
  assert.deepEqual(activate({ noTools: "all" }, ext).active, []);
});

test("--tools 是允许表：内置、扩展、SDK 一视同仁；不认识的名字忽略", () => {
  assert.deepEqual(activate({ tools: ["read", "deploy", "ghost"] }, ext, [{ name: "sdk_tool" }]).active, ["read", "deploy"]);
});

test("--tools 优先于 --no-tools", () => {
  assert.deepEqual(activate({ tools: ["read"], noTools: "all" }, ext).active, ["read"]);
});

test("--exclude-tools 在最后排除", () => {
  assert.deepEqual(activate({ tools: ["read", "bash"], excludeTools: ["bash"] }).active, ["read"]);
  assert.deepEqual(activate({ excludeTools: ["deploy", "edit"] }, ext).active, ["read", "bash", "write", "find_text"]);
});

test("defaultTools 设置只替换默认的四个内置工具", () => {
  assert.deepEqual(activate({ defaultTools: ["read", "grep"] }, ext).active, ["read", "grep", "find_text", "deploy"]);
});

test("同名覆盖：扩展顶掉内置，promptSnippet 不继承", () => {
  const a = activate({}, [{ name: "read" }]);
  assert.deepEqual(a.overridden, ["read"]);
  assert.equal(a.sources.read, "extension");
  assert.ok(a.unlisted.includes("read"));
});

test("SDK 工具后进表，同名时顶掉扩展工具", () => {
  const a = activate({}, [{ name: "x", promptSnippet: "ext" }], [{ name: "x" }]);
  assert.equal(a.sources.x, "sdk");
  assert.deepEqual(a.unlisted, ["x"]);
});

test("Guidelines：去空、去重；有 bash 没有 grep/find/ls 时补一条", () => {
  const a = activate({}, [...ext, { name: "dup", promptGuidelines: ["Use find_text for search"] }]);
  assert.deepEqual(a.guidelines, ["Use bash for file operations like ls, rg, find", "Use find_text for search"]);
  assert.deepEqual(activate({ tools: ["bash", "grep"] }).guidelines, []);
});

test("Guidelines 只来自激活的工具", () => {
  assert.deepEqual(activate({ tools: ["read"] }, ext).guidelines, []);
});

test("promptSnippet 压成一行；空白等于没给", () => {
  const a = activate({ tools: ["a", "b"] }, [{ name: "a", promptSnippet: "two\nlines" }, { name: "b", promptSnippet: "  \n " }]);
  assert.deepEqual([a.listed, a.unlisted], [["a"], ["b"]]);
});

test("启动后再注册：新名字自动激活，之前关掉的不回来", () => {
  const before = activate({ excludeTools: [] }, ext);
  const narrowed = { ...before, active: before.active.filter((n) => n !== "deploy") };
  const after = registerLater({}, narrowed, ext, { name: "echo", promptSnippet: "Echo" });
  assert.ok(after.active.includes("echo"));
  assert.ok(!after.active.includes("deploy"));
});

test("启动后再注册：有 --tools 时只有允许表里的才激活", () => {
  const flags = { tools: ["read", "echo"] };
  assert.deepEqual(registerLater(flags, activate(flags, ext), ext, { name: "echo" }).active, ["read", "echo"]);
  assert.deepEqual(registerLater({ tools: ["read"] }, activate({ tools: ["read"] }, ext), ext, { name: "echo" }).active, ["read"]);
});

test("启动后重新注册同名工具：不算新名字，保持原来的激活状态", () => {
  const before = activate({}, ext);
  const narrowed = { ...before, active: before.active.filter((n) => n !== "deploy") };
  assert.ok(!registerLater({}, narrowed, ext, { name: "deploy", promptSnippet: "v2" }).active.includes("deploy"));
});
