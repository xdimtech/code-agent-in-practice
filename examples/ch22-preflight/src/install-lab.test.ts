import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { runInstallLab, VARIANTS } from "./install-lab.ts";

const hasNpm = spawnSync("npm", ["--version"], { encoding: "utf8" }).status === 0;

test("真跑 npm：默认跑脚本且看得见环境变量，两种关法都不跑", { skip: !hasNpm && "没有 npm" }, () => {
	const rows = runInstallLab();
	assert.deepEqual(
		rows.map((row) => [row.label, row.exitCode, row.ran, row.sawToken]),
		[
			["pi 默认", 0, true, true],
			["A 环境变量", 0, false, false],
			["B npmCommand", 0, false, false],
		],
	);
});

test("三种写法的定义：只有 A 动环境，只有 B 动参数", () => {
	assert.deepEqual(VARIANTS.map((v) => [v.npmArgs.length > 0, Object.keys(v.extraEnv).length > 0]), [
		[false, false],
		[false, true],
		[true, false],
	]);
});

test("npm 跑不起来时报错，不当作「没跑」", () => {
	assert.throws(() => runInstallLab("definitely-not-a-real-npm-binary"), /跑不了/);
});
