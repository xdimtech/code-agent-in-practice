/**
 * 工具的行为测试。重点不是「读到了没」，而是**边界怎么处理**：
 * 哪些失败变成结果，哪些失败直接抛。这条线是整个第 15 章策略层的前提。
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createListDirTool, createReadFileTool, createWriteFileTool, isInsideRoot, isMutating } from "./tools.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "ch01-tools-"));
}

/** 把结果里的文本块拼起来，测试里要断言的多半是它。 */
function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
	return result.content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

// ── read_file ───────────────────────────────────────────────────────────

test("read_file 去掉结尾的换行，不把最后一行算成空行", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "a.txt"), "第一行\n第二行\n", "utf8");

	const result = createReadFileTool().execute({ path: join(dir, "a.txt") });

	assert.equal(result.isError, false);
	assert.equal(textOf(result), "第一行\n第二行");
});

test("read_file 超过 200 行时截断，并告诉模型还剩多少", () => {
	const dir = tempDir();
	const lines = Array.from({ length: 260 }, (_, i) => `第 ${i + 1} 行`);
	writeFileSync(join(dir, "big.txt"), lines.join("\n"), "utf8");

	const result = createReadFileTool().execute({ path: join(dir, "big.txt") });
	const text = textOf(result);

	assert.equal(result.isError, false);
	// 截断标记本身也是一行内容，得说清楚是「还有 60 行」而不是「一共 60 行」。
	assert.match(text, /还有 60 行/);
	assert.ok(text.split("\n").length < 260);
});

test("read_file 文件不存在时返回失败结果，不抛异常", () => {
	const result = createReadFileTool().execute({ path: join(tempDir(), "没有这个文件.txt") });

	assert.equal(result.isError, true);
	assert.equal(result.details, "enoent");
	assert.match(textOf(result), /文件不存在/);
});

test("read_file 指到目录上时是 eisdir，不是崩", () => {
	const result = createReadFileTool().execute({ path: tempDir() });

	assert.equal(result.isError, true);
	assert.equal(result.details, "eisdir");
});

test("read_file 缺参数时返回失败结果", () => {
	const result = createReadFileTool().execute({});

	assert.equal(result.isError, true);
	assert.equal(result.details, "missing-arg");
});

// ── list_dir ────────────────────────────────────────────────────────────

test("list_dir 给目录加尾斜杠，文件不加", () => {
	const dir = tempDir();
	mkdirSync(join(dir, "sub"));
	writeFileSync(join(dir, "b.txt"), "x", "utf8");

	const result = createListDirTool().execute({ path: dir });
	const entries = textOf(result).split("\n");

	assert.deepEqual(entries, ["b.txt", "sub/"]);
});

test("list_dir 不传 path 时用当前目录，不是报错", () => {
	const result = createListDirTool().execute({});

	// 当前目录一定存在，所以这里关心的是「没有崩」，不是列了什么。
	assert.equal(result.isError, false);
	assert.equal(result.details.includes("个条目"), true);
});

test("list_dir 对不存在的目录返回失败结果", () => {
	const result = createListDirTool().execute({ path: join(tempDir(), "没这目录") });

	assert.equal(result.isError, true);
	assert.equal(result.details, "enoent");
});

test("list_dir 指到文件上是 enotdir，不是崩", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "c.txt"), "x", "utf8");

	const result = createListDirTool().execute({ path: join(dir, "c.txt") });

	assert.equal(result.isError, true);
	assert.equal(result.details, "enotdir");
});

// ── write_file ──────────────────────────────────────────────────────────

test("write_file 覆盖原内容，并报出字节数", () => {
	const dir = tempDir();
	const target = join(dir, "d.txt");
	writeFileSync(target, "旧内容", "utf8");

	const result = createWriteFileTool().execute({ path: target, content: "新" });

	assert.equal(result.isError, false);
	assert.equal(readFileSync(target, "utf8"), "新");
	// 字节数按 UTF-8 算，「新」是 3 字节而不是 1。
	assert.equal(result.details, "3 字节");
});

test("write_file 空字符串是合法内容，不能当成缺参数", () => {
	const dir = tempDir();
	const target = join(dir, "empty.txt");

	const result = createWriteFileTool().execute({ path: target, content: "" });

	assert.equal(result.isError, false);
	assert.equal(readFileSync(target, "utf8"), "");
});

test("write_file 缺 content 时失败", () => {
	const result = createWriteFileTool().execute({ path: join(tempDir(), "x.txt") });

	assert.equal(result.isError, true);
	assert.equal(result.details, "missing-arg");
});

test("write_file 目标目录不存在时失败，且没有留下半个文件", () => {
	const target = join(tempDir(), "没有的目录", "x.txt");

	const result = createWriteFileTool().execute({ path: target, content: "x" });

	assert.equal(result.isError, true);
	assert.equal(result.details, "enoent");
});

// ── 分类与路径 ──────────────────────────────────────────────────────────

test("isMutating 只认写工具", () => {
	assert.equal(isMutating(createWriteFileTool()), true);
	assert.equal(isMutating(createReadFileTool()), false);
	assert.equal(isMutating(createListDirTool()), false);
});

test("isInsideRoot 挡住往上爬，也挡住前缀相同的兄弟目录", () => {
	const root = tempDir();
	mkdirSync(join(root, "inner"));

	assert.equal(isInsideRoot(root, "inner/file.txt"), true);
	// 根目录自己也算在内——相对路径算出来是空串。
	assert.equal(isInsideRoot(root, "."), true);
	assert.equal(isInsideRoot(root, "../../etc/passwd"), false);
	// 中间绕一下再爬出去，resolve 折叠之后照样是越界。
	assert.equal(isInsideRoot(root, "inner/../../evil.txt"), false);
	// 关键用例：`/tmp/x-evil` 以 `/tmp/x` 开头，但不在它里面。
	// 用字符串前缀判断的实现会在这里放行。
	assert.equal(isInsideRoot(root, `${root}-evil/file.txt`), false);
});

test("isInsideRoot 不因为名字里有 .. 就误判", () => {
	const root = tempDir();

	// `..foo` 是个合法的文件名，不含目录穿越。
	assert.equal(isInsideRoot(root, "..foo"), true);
	assert.equal(isInsideRoot(root, "a..b/c.txt"), true);
});
