import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FILE, DEFAULT_TOOL, ENV_FILE, ENV_TOOL, lazySettings, resolveSettings } from "./settings.ts";

const none = () => undefined;

test("什么都没有：用默认值", () => {
	assert.deepEqual(resolveSettings(none, {}), { file: DEFAULT_FILE, tool: DEFAULT_TOOL, report: true });
});

test("环境变量兜底", () => {
	assert.equal(resolveSettings(none, { [ENV_FILE]: "other.txt" }).file, "other.txt");
	assert.equal(resolveSettings(none, { [ENV_TOOL]: "bash" }).tool, "bash");
});

test("旗标优先于环境变量", () => {
	const flag = (name: string) => (name === "demo-file" ? "from-flag.txt" : undefined);
	assert.equal(resolveSettings(flag, { [ENV_FILE]: "from-env.txt" }).file, "from-flag.txt");
});

test("空字符串不算数：旗标空就退到环境变量，环境变量也空就退到默认", () => {
	assert.equal(resolveSettings((n) => (n === "demo-file" ? "" : undefined), { [ENV_FILE]: "from-env.txt" }).file, "from-env.txt");
	assert.equal(resolveSettings((n) => (n === "demo-file" ? "" : undefined), { [ENV_FILE]: "" }).file, DEFAULT_FILE);
	assert.equal(resolveSettings((n) => (n === "demo-tool" ? "" : undefined), { [ENV_TOOL]: "" }).tool, DEFAULT_TOOL);
});

test("布尔旗标只认 true", () => {
	assert.equal(resolveSettings((n) => (n === "demo-quiet" ? true : undefined), {}).report, false);
	assert.equal(resolveSettings((n) => (n === "demo-quiet" ? "yes" : undefined), {}).report, true);
	assert.equal(resolveSettings((n) => (n === "demo-quiet" ? false : undefined), {}).report, true);
});

test("lazySettings：第一次调用才读旗标，之后不再读", () => {
	// 这就是这个例子踩过的坑：注册 provider 时读得太早，
	// 命令行给的值还没写进 runtime.flagValues，抄下来永远是默认值。
	// 延迟到第一次真的要用的时候读，值才是对的。
	let reads = 0;
	let value: string | undefined;
	const settings = lazySettings((name) => {
		if (name !== "demo-file") return undefined;
		reads += 1;
		return value;
	}, {});

	assert.equal(reads, 0, "建出来的时候不读");
	value = "late.txt";
	assert.equal(settings().file, "late.txt", "第一次读到的就是后来才有的值");
	assert.equal(reads, 1);
	assert.equal(settings().file, "late.txt");
	assert.equal(reads, 1, "第二次不再读");
	assert.equal(settings().file, "late.txt");
	assert.equal(reads, 1);
});

test("lazySettings：结果只解一次，是同一份对象", () => {
	const settings = lazySettings(none, {});
	assert.equal(settings(), settings());
});
