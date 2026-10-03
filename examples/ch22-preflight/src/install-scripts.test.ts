import assert from "node:assert/strict";
import { test } from "node:test";
import { installScriptStatus, packageManagerName } from "./install-scripts.ts";

test("packageManagerName 跟 pi 一样取 `--` 之后那一项", () => {
	assert.equal(packageManagerName(undefined), "npm");
	assert.equal(packageManagerName([]), "npm");
	assert.equal(packageManagerName(["npm", "--ignore-scripts"]), "npm");
	assert.equal(packageManagerName(["/opt/homebrew/bin/pnpm"]), "pnpm");
	assert.equal(packageManagerName(["C:\\tools\\npm.cmd"]), "npm");
	assert.equal(packageManagerName(["mise", "exec", "node@20", "--", "npm"]), "npm");
	assert.equal(packageManagerName(["mise", "--"]), "");
});

test("默认：npm 会跑安装脚本", () => {
	assert.deepEqual(installScriptStatus({ env: {} }), { kind: "runs", manager: "npm" });
});

test("参数里带 --ignore-scripts 就不跑", () => {
	for (const flag of ["--ignore-scripts", "--ignore-scripts=true"]) {
		assert.deepEqual(installScriptStatus({ npmCommand: ["npm", flag], env: {} }), { kind: "skipped", manager: "npm", via: "argv" });
	}
	assert.equal(installScriptStatus({ npmCommand: ["npm", "--ignore-scripts=false"], env: {} }).kind, "runs");
});

test("mise 包一层：只看 `--` 之后的参数", () => {
	assert.equal(installScriptStatus({ npmCommand: ["mise", "--ignore-scripts", "--", "npm"], env: {} }).kind, "runs");
	assert.equal(installScriptStatus({ npmCommand: ["mise", "exec", "--", "npm", "--ignore-scripts"], env: {} }).kind, "skipped");
});

test("环境变量：大小写都认，值只认 true", () => {
	assert.deepEqual(installScriptStatus({ env: { npm_config_ignore_scripts: "true" } }), { kind: "skipped", manager: "npm", via: "env" });
	assert.equal(installScriptStatus({ env: { NPM_CONFIG_IGNORE_SCRIPTS: "true" } }).kind, "skipped");
	assert.equal(installScriptStatus({ env: { npm_config_ignore_scripts: "1" } }).kind, "runs");
	assert.equal(installScriptStatus({ env: { npm_config_ignore_scripts: undefined } }).kind, "runs");
});

test("pnpm、bun 不下结论；不认识的包管理器报 unknown", () => {
	assert.deepEqual(installScriptStatus({ npmCommand: ["pnpm"], env: {} }), { kind: "manager-default", manager: "pnpm" });
	assert.deepEqual(installScriptStatus({ npmCommand: ["bun"], env: {} }), { kind: "manager-default", manager: "bun" });
	assert.deepEqual(installScriptStatus({ npmCommand: ["yarn"], env: {} }), { kind: "unknown", manager: "yarn" });
});
