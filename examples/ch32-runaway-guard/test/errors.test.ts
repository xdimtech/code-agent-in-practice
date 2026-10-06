import { strict as assert } from "node:assert";
import { test } from "node:test";

import { errorFamily, isExpectedNoMatch } from "../src/errors.ts";

const result = (text: string, code?: string) => ({ id: "x", isError: true, text, ...(code ? { code } : {}) });
const bash = (command: string) => ({ id: "x", tool: "bash", args: { command } });

test("errorFamily：结构化错误码优先", () => {
	assert.equal(errorFamily("fetch", result("request timed out", "E_UPSTREAM")), "fetch\u0000code:E_UPSTREAM");
});

test("errorFamily：措辞不同、类别相同，归成一族", () => {
	const a = errorFamily("bash", result("request timed out after 5s"));
	assert.equal(a, errorFamily("bash", result("Deadline exceeded")));
	assert.equal(a, "bash\u0000category:timeout");
});

test("errorFamily：同一类别、不同工具，不是一族", () => {
	assert.notEqual(errorFamily("bash", result("timeout")), errorFamily("fetch", result("timeout")));
});

test("errorFamily：认不出类别就用截断、归一空白后的原文", () => {
	assert.equal(errorFamily("edit", result("old_string  not\nunique")), "edit\u0000text:old_string not unique");
	assert.equal(errorFamily("edit", result("y".repeat(5000)))!.length, "edit\u0000text:".length + 1024);
	assert.equal(errorFamily("edit", result("   ")), undefined);
});

test("isExpectedNoMatch：单条 rg / grep 没找到是答案", () => {
	const noMatch = result("command exited with code 1");
	assert.equal(isExpectedNoMatch(bash("rg TODO src"), noMatch), true);
	assert.equal(isExpectedNoMatch(bash("git grep -n foo"), noMatch), true);
});

test("isExpectedNoMatch：复合命令、别的退出码、别的工具，都不算", () => {
	const noMatch = result("command exited with code 1");
	assert.equal(isExpectedNoMatch(bash("rg TODO src | wc -l"), noMatch), false);
	assert.equal(isExpectedNoMatch(bash("rg TODO $(pwd)"), noMatch), false);
	assert.equal(isExpectedNoMatch(bash("rg TODO; rm -rf x"), noMatch), false);
	assert.equal(isExpectedNoMatch(bash("rg TODO src"), result("command exited with code 2")), false);
	assert.equal(isExpectedNoMatch(bash("cat missing"), noMatch), false);
	assert.equal(isExpectedNoMatch({ id: "x", tool: "read", args: { command: "rg x" } }, noMatch), false);
});
