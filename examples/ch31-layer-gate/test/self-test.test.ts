import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkImport } from "../src/classify.ts";
import { extractImports } from "../src/imports.ts";
import { EDGE_CASES, runSelfTest } from "../src/self-test.ts";
import type { Violation } from "../src/types.ts";

const MAIN_TS = resolve(fileURLToPath(import.meta.url), "../../src/main.ts");

test("自测：真的判定和抽取全部通过", () => {
	assert.deepEqual(runSelfTest(), []);
});

test("自测覆盖了三种违规和放行", () => {
	const kinds = new Set(EDGE_CASES.map((c) => c.expect ?? "allow"));
	assert.deepEqual([...kinds].toSorted(), ["allow", "forbidden-edge", "unassigned-importer", "unassigned-target"]);
});

// 下面几条是「自测的自测」：换成坏掉的闸门，自测必须失败

test("什么都放行的闸门过不了自测", () => {
	assert.ok(runSelfTest(() => undefined).length >= 9);
});

test("什么都拦的闸门过不了自测", () => {
	const blockAll = (_c: unknown, importer: string, specifier: string): Violation => ({ kind: "forbidden-edge", importer, specifier, message: "" });
	assert.ok(runSelfTest(blockAll).length >= 7);
});

test("对认不出的目标失败开放的闸门过不了自测", () => {
	const failOpen: typeof checkImport = (config, importer, specifier) => {
		const v = checkImport(config, importer, specifier);
		return v?.kind === "forbidden-edge" ? v : undefined;
	};
	const failures = runSelfTest(failOpen);
	assert.equal(failures.length, 4);
	assert.ok(failures.every((f) => f.includes("得到 放行")));
});

test("不认动态 import 的抽取过不了自测", () => {
	const noDynamic = (source: string) => extractImports(source.replace(/import\(/g, "load("));
	assert.equal(runSelfTest(checkImport, noDynamic).length, 1);
});

test("不涂注释的抽取过不了自测", () => {
	const naive = (source: string) => [...source.matchAll(/from\s*"([^"]+)"|import\s*"([^"]+)"/g)].map((m) => ({ specifier: (m[1] ?? m[2])!, line: 1 }));
	assert.ok(runSelfTest(checkImport, naive).length >= 1);
});

test("--self-test 从命令行跑，退出码 0", () => {
	const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", MAIN_TS, "--self-test"], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /自测通过/);
});
