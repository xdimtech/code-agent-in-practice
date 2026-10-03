import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSettings } from "./settings.ts";

test("没设返回空对象，别的键不管", () => {
	assert.deepEqual(parseSettings("{}"), {});
	assert.deepEqual(parseSettings('{"theme":"dark"}'), {});
});

test("三项都读出来", () => {
	const text = JSON.stringify({ npmCommand: ["npm", "--ignore-scripts"], shellPath: "/bin/zsh", shellCommandPrefix: "shopt -s expand_aliases" });
	assert.deepEqual(parseSettings(text), { npmCommand: ["npm", "--ignore-scripts"], shellPath: "/bin/zsh", shellCommandPrefix: "shopt -s expand_aliases" });
});

test("坏文件直接报错，不当成没设", () => {
	assert.throws(() => parseSettings("{"), /不是合法的 JSON/);
	assert.throws(() => parseSettings("[]"), /顶层必须是对象/);
	assert.throws(() => parseSettings("null"), /顶层必须是对象/);
});

test("npmCommand 必须是非空字符串数组", () => {
	for (const bad of ['"npm"', "[]", '[""]', "[1]"]) {
		assert.throws(() => parseSettings(`{"npmCommand":${bad}}`), /npmCommand 必须是/, bad);
	}
});

test("shellPath / shellCommandPrefix 必须是非空字符串", () => {
	assert.throws(() => parseSettings('{"shellPath":""}'), /shellPath/);
	assert.throws(() => parseSettings('{"shellCommandPrefix":1}'), /shellCommandPrefix/);
});
