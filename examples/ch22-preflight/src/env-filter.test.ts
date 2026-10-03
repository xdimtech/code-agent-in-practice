import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ENV_POLICY, denylistOnlyKeeps, envSpawnHook, filterEnv, keeps, withBinDir, withExtraAllow, wrapOperations, type Env, type ExecOptions, type Operations } from "./env-filter.ts";

const ENV: Env = {
	PATH: "/usr/bin",
	HOME: "/home/u",
	LC_ALL: "C",
	PI_SESSION_ID: "s1",
	ANTHROPIC_API_KEY: "<placeholder>",
	GITHUB_TOKEN: "<placeholder>",
	DATABASE_URL: "<placeholder>",
	SSH_AUTH_SOCK: "/tmp/agent",
	UNSET: undefined,
};

test("白名单：只留名单里的和前缀匹配的，结果排好序", () => {
	const { env, kept, dropped } = filterEnv(ENV);
	assert.deepEqual(kept, ["HOME", "LC_ALL", "PATH", "PI_SESSION_ID"]);
	assert.deepEqual(dropped, ["ANTHROPIC_API_KEY", "DATABASE_URL", "GITHUB_TOKEN", "SSH_AUTH_SOCK"]);
	assert.deepEqual(Object.keys(env).sort(), kept);
	assert.equal(env.PATH, "/usr/bin");
});

test("值为 undefined 的变量不出现在任何一边", () => {
	const { kept, dropped } = filterEnv(ENV);
	assert.ok(!kept.includes("UNSET") && !dropped.includes("UNSET"));
});

test("deny 压过 allow：前缀放行的名字长得像凭据也拿掉", () => {
	assert.equal(keeps(DEFAULT_ENV_POLICY, "PI_SESSION_ID"), true);
	assert.equal(keeps(DEFAULT_ENV_POLICY, "PI_API_KEY"), false);
	assert.equal(keeps(DEFAULT_ENV_POLICY, "LC_TOKEN"), false);
	assert.equal(keeps(withExtraAllow(DEFAULT_ENV_POLICY, ["MY_PASSWORD"]), "MY_PASSWORD"), false);
});

test("deny 不分大小写", () => {
	assert.equal(keeps({ ...DEFAULT_ENV_POLICY, allow: ["npm_config__authtoken"] }, "npm_config__authtoken"), false);
});

test("withExtraAllow：加名字返回新策略，不改原来的；名字不合法就拒绝", () => {
	const extended = withExtraAllow(DEFAULT_ENV_POLICY, ["JAVA_HOME", "PATH"]);
	assert.ok(extended.allow.includes("JAVA_HOME"));
	assert.equal(extended.allow.filter((n) => n === "PATH").length, 1);
	assert.ok(!DEFAULT_ENV_POLICY.allow.includes("JAVA_HOME"));
	assert.throws(() => withExtraAllow(DEFAULT_ENV_POLICY, ["OK", "1BAD", "A-B"]), /1BAD, A-B/);
});

test("只用黑名单会放过名字不带关键字的凭据", () => {
	const slipped = denylistOnlyKeeps(ENV).filter((name) => !filterEnv(ENV).kept.includes(name));
	assert.deepEqual(slipped, ["DATABASE_URL"]);
});

test("filterEnv 不改传入的环境", () => {
	const input = { ...ENV };
	filterEnv(input);
	assert.deepEqual(input, ENV);
});

test("envSpawnHook：只换 env，command 和 cwd 原样", () => {
	const out = envSpawnHook()({ command: "env", cwd: "/w", env: ENV });
	assert.equal(out.command, "env");
	assert.equal(out.cwd, "/w");
	assert.deepEqual(Object.keys(out.env).sort(), ["HOME", "LC_ALL", "PATH", "PI_SESSION_ID"]);
});

const recorder = () => {
	const seen: ExecOptions[] = [];
	const inner: Operations = {
		exec: async (_command, _cwd, options) => {
			seen.push(options);
			return { exitCode: 0 };
		},
	};
	return { seen, inner };
};

test("wrapOperations：执行器不给 env 时用 baseEnv，并且过滤", async () => {
	const { seen, inner } = recorder();
	const onData = () => {};
	await wrapOperations(inner, () => ENV).exec("ls", "/w", { onData, timeout: 5 });
	assert.equal(seen[0]?.onData, onData);
	assert.equal(seen[0]?.timeout, 5);
	assert.deepEqual(Object.keys(seen[0]?.env ?? {}).sort(), ["HOME", "LC_ALL", "PATH", "PI_SESSION_ID"]);
});

test("wrapOperations：执行器给了 env 就过滤给的那份，不读 baseEnv", async () => {
	const { seen, inner } = recorder();
	let read = 0;
	await wrapOperations(inner, () => (read++, ENV)).exec("ls", "/w", { onData: () => {}, env: { PATH: "/x", NPM_TOKEN: "<placeholder>" } });
	assert.equal(read, 0);
	assert.deepEqual(seen[0]?.env, { PATH: "/x" });
});

test("withBinDir：照 pi 的 getShellEnv 把 bin 目录放到 PATH 最前面，已有就不重复", () => {
	assert.equal(withBinDir({ PATH: "/usr/bin" }, "/h/.pi/agent/bin").PATH, "/h/.pi/agent/bin:/usr/bin");
	const already = { PATH: "/usr/bin:/h/.pi/agent/bin" };
	assert.equal(withBinDir(already, "/h/.pi/agent/bin"), already);
	assert.equal(withBinDir({}, "/b").PATH, "/b");
	assert.deepEqual(withBinDir({ Path: "C:\\x" }, "C:\\b", ";"), { Path: "C:\\b;C:\\x" });
});
