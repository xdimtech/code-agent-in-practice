import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ROOT_PLACEHOLDER, rootOf, stripRoot } from "../src/root.ts";
import { normalizeValue } from "../src/trace.ts";

test("抹掉根目录前缀，其余照旧", () => {
	assert.equal(stripRoot("/tmp/ch23-eval-abc/work/a.txt", "/tmp/ch23-eval-abc"), `${ROOT_PLACEHOLDER}/work/a.txt`);
	assert.equal(stripRoot("/tmp/ch23-eval-abc", "/tmp/ch23-eval-abc"), ROOT_PLACEHOLDER);
});

test("只是前缀相同但不是一个目录的，不能抹", () => {
	// /tmp/ch23-eval-abcdef 是另一个目录，抹了就把两次运行混成一次
	assert.equal(stripRoot("/tmp/ch23-eval-abcdef/work/a.txt", "/tmp/ch23-eval-abc"), "/tmp/ch23-eval-abcdef/work/a.txt");
});

test("空根目录等于不抹：这是默认值，没显式传就不动路径", () => {
	assert.equal(stripRoot("/tmp/anything", ""), "/tmp/anything");
});

test("Windows 写法也认", () => {
	assert.equal(stripRoot("C:\\tmp\\ws\\work\\a.txt", "C:/tmp/ws"), `${ROOT_PLACEHOLDER}\\work\\a.txt`);
});

test("rootOf 把目录规整成绝对路径，两次写法的结果一样", () => {
	assert.equal(rootOf("/tmp/ws/../ws"), rootOf("/tmp/ws"));
});

test("归一化和抹根串起来用：两种路径写法归到同一个字符串", () => {
	const options = { root: "/tmp/ch23-eval-abc" };
	assert.equal(normalizeValue("/tmp/ch23-eval-abc/work/a.txt", options), normalizeValue("/tmp/ch23-eval-abc/work/a.txt", options));
	assert.equal(normalizeValue("/tmp/ch23-eval-abc/work/a.txt", options), `${ROOT_PLACEHOLDER}/work/a.txt`);
});
