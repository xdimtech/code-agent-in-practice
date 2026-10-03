import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { main, SAMPLE_ENV } from "./main.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** 跑一次 main，收集它打到 stdout / stderr 的东西 */
function capture(t: TestContext, argv: readonly string[]) {
	const out: string[] = [];
	const err: string[] = [];
	t.mock.method(console, "log", (...args: unknown[]) => out.push(args.join(" ")));
	t.mock.method(console, "error", (...args: unknown[]) => err.push(args.join(" ")));
	const code = main(argv);
	t.mock.restoreAll();
	return { code, out: out.join("\n"), err: err.join("\n") };
}

test("用法错误退出码 2", (t) => {
	assert.equal(capture(t, ["nope"]).code, 2);
	assert.equal(capture(t, ["checklist", "--settings"]).code, 2);
	const missing = capture(t, ["checklist", "--settings", join(FIXTURES, "no-such-file.json")]);
	assert.equal(missing.code, 2);
	assert.match(missing.err, /读不了/);
});

test("help 退出码 0", (t) => {
	assert.match(capture(t, []).out, /用法/);
});

test("env：示例环境只打印名字，不打印值", (t) => {
	const { code, out } = capture(t, ["env"]);
	assert.equal(code, 0);
	assert.match(out, /白名单留下 9：HOME LANG LC_ALL PATH PI_SESSION_ID SHELL TERM TMPDIR USER/);
	assert.match(out, /白名单拿掉 13：/);
	assert.match(out, /只用黑名单会多放过 6 个：DATABASE_URL HTTPS_PROXY KUBECONFIG REDIS_URL SENTRY_DSN npm_config_ignore_scripts/);
	assert.ok(!out.includes("<placeholder>"));
	assert.equal(Object.keys(SAMPLE_ENV).length, 22);
});

test("env --real：拿掉的名字也不打印", (t) => {
	const { out } = capture(t, ["env", "--real"]);
	assert.match(out, /名字不打印/);
	assert.doesNotMatch(out, /多放过 \d+ 个：/);
});

test("loop：场景一、三在第 4 次拦下，场景二一直放行", (t) => {
	const { out } = capture(t, ["loop"]);
	const sections = out.split(/\n  (?=[一二三]、)/);
	assert.equal(sections.length, 4);
	assert.match(sections[1] ?? "", /拦下  第 4 次  npm test/);
	assert.doesNotMatch(sections[2] ?? "", /拦下/);
	assert.match(sections[3] ?? "", /拦下  第 4 次  npm test/);
});

test("checklist：npmCommand 带 --ignore-scripts 时扩展装上后全部到位", (t) => {
	const { code, out } = capture(t, ["checklist", "--settings", join(FIXTURES, "settings-ignore-scripts.json")]);
	assert.equal(code, 0);
	assert.match(out, /必补全部到位：是/);
});

test("checklist：pnpm 时安装脚本算一半，退出码 1", (t) => {
	const { code, out } = capture(t, ["checklist", "--settings", join(FIXTURES, "settings-pnpm.json")]);
	assert.equal(code, 1);
	assert.match(out, /pnpm 默认不跑依赖脚本/);
});
