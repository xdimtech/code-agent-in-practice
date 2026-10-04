import { strict as assert } from "node:assert";
import { test } from "node:test";

import { blankNonCode, extractImports } from "../src/imports.ts";

test("blankNonCode：注释和模板内容涂空，长度和换行不变", () => {
	const source = 'a // x\n/* y\nz */ b `t\nu` "s"';
	const out = blankNonCode(source);
	assert.equal(out.length, source.length);
	assert.equal(out.split("\n").length, source.split("\n").length);
	assert.ok(!/[xyztu]/.test(out));
	assert.ok(out.includes('"s"'));
});

test("blankNonCode：字符串里的 // 不是注释", () => {
	assert.deepEqual(extractImports('import a from "http://x";\nimport b from "b";').map((r) => r.specifier), ["http://x", "b"]);
});

test("blankNonCode：转义的引号不结束字符串", () => {
	assert.deepEqual(extractImports('const s = "a\\"b";\nimport c from "c";').map((r) => r.specifier), ["c"]);
});

test("extractImports：export { a } from 和 import type 都认", () => {
	const refs = extractImports('export { a, type B } from "./a.ts";\nimport type { C } from "./c.ts";');
	assert.deepEqual(refs, [
		{ specifier: "./a.ts", line: 1 },
		{ specifier: "./c.ts", line: 2 },
	]);
});

test("extractImports：默认导入加具名导入", () => {
	assert.deepEqual(extractImports('import d, { e } from "de";').map((r) => r.specifier), ["de"]);
});

test("extractImports：单引号和动态 import 的空白", () => {
	assert.deepEqual(extractImports("const m = await import( 'm' );").map((r) => r.specifier), ["m"]);
});

test("extractImports：标识符里的 import 不算", () => {
	assert.deepEqual(extractImports('const importer = "x";\nmyimport("y");\nobj.require("z");'), []);
});

test("extractImports：模板字符串里的 import 不算，模板后面的算", () => {
	const refs = extractImports('const t = `\nimport x from "x";\n`;\nimport y from "y";');
	assert.deepEqual(refs, [{ specifier: "y", line: 4 }]);
});
