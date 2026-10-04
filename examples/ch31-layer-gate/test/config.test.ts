import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findCycle, parseConfig } from "../src/config.ts";
import type { Layer } from "../src/types.ts";

const layer = (name: string, mayImport: string[] = [], paths = [`packages/${name}/src/`]) => ({ name, paths, packages: [], mayImport });

function errorsOf(raw: unknown): readonly string[] {
	const result = parseConfig(raw);
	assert.equal(result.ok, false);
	return result.ok ? [] : result.errors;
}

test("parseConfig：合法配置原样带出，缺省字段补空数组", () => {
	const result = parseConfig({ layers: [{ name: "a", paths: ["a/"] }, layer("b", ["a"])] });
	assert.ok(result.ok);
	assert.deepEqual(result.config.layers[0], { name: "a", paths: ["a/"], packages: [], mayImport: [] });
	assert.deepEqual(result.config.internalScopes, []);
	assert.deepEqual(result.config.ignore, []);
});

test("parseConfig：本例自带的 pi 配置是合法的", () => {
	const path = resolve(fileURLToPath(import.meta.url), "../../config/pi.json");
	const result = parseConfig(JSON.parse(readFileSync(path, "utf8")));
	assert.ok(result.ok, result.ok ? "" : result.errors.join("\n"));
});

test("parseConfig：不是对象、没有层", () => {
	assert.match(errorsOf(null)[0]!, /JSON 对象/);
	assert.match(errorsOf([])[0]!, /JSON 对象/);
	assert.match(errorsOf({ layers: [] })[0]!, /至少要有一层/);
});

test("parseConfig：形状错误一次报全", () => {
	const errors = errorsOf({ layers: [{ name: "a b", paths: [] }, "x", { name: "c", paths: ["c/"], mayImport: [1] }], ignore: "x" });
	assert.equal(errors.length, 5);
	assert.ok(errors.some((e) => e.startsWith("layers[0].name")));
	assert.ok(errors.some((e) => e.startsWith("layers[0].paths") && e.includes("至少要有一项")));
	assert.ok(errors.some((e) => e.startsWith("layers[1]：要是对象")));
	assert.ok(errors.some((e) => e.startsWith("layers[2].mayImport")));
	assert.ok(errors.some((e) => e.startsWith("ignore")));
});

test("parseConfig：路径要以 / 结尾、不能是绝对路径、不能含 ..", () => {
	for (const bad of ["a/src", "/abs/", "a/../b/"]) {
		assert.match(errorsOf({ layers: [layer("a", [], [bad])] })[0]!, /以 \/ 结尾的仓库相对目录/);
	}
});

test("parseConfig：重名、引用不存在的层、引用自己", () => {
	assert.match(errorsOf({ layers: [layer("a"), layer("a")] })[0]!, /重复了/);
	assert.match(errorsOf({ layers: [layer("a", ["ghost"])] })[0]!, /没有叫「ghost」的层/);
	assert.match(errorsOf({ layers: [layer("a", ["a"])] })[0]!, /不用写自己/);
});

test("parseConfig：成环的配置被拒，错误里带着环", () => {
	const errors = errorsOf({ layers: [layer("a", ["b"]), layer("b", ["c"]), layer("c", ["a"])] });
	assert.deepEqual(errors, ["mayImport 成环：a → b → c → a"]);
});

test("findCycle：菱形依赖不是环", () => {
	const layers: Layer[] = [layer("top", ["l", "r"]), layer("l", ["base"]), layer("r", ["base"]), layer("base")];
	assert.equal(findCycle(layers), undefined);
});

test("parseConfig：不改动传进来的对象", () => {
	const raw = { layers: [layer("a")] };
	const before = JSON.stringify(raw);
	parseConfig(raw);
	assert.equal(JSON.stringify(raw), before);
});
