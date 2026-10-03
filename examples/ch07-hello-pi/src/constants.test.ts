import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_DIR_FILES, ENV_AGENT_DIR, ENV_FLAGS, MIN_NODE, PROVIDER_ENV_KEYS } from "./constants.ts";
import { checkCredentials } from "./doctor.ts";

test("环境变量名是 pi 真正读的那个", () => {
	assert.equal(ENV_AGENT_DIR, "PI_CODING_AGENT_DIR");
	assert.ok(ENV_FLAGS.includes("PI_OFFLINE"));
});

test("Node 下限和 pi 的 engines 一致", () => {
	assert.deepEqual([...MIN_NODE], [22, 19, 0]);
});

test("凭据变量名里没有值，也没有一个是空的", () => {
	for (const name of PROVIDER_ENV_KEYS) {
		assert.match(name, /^[A-Z][A-Z0-9_]*$/);
		assert.ok(name.endsWith("_API_KEY"), `${name} 看起来不是 key 变量`);
	}
});

test("agent 目录文件：只有凭据类是私有的", () => {
	const priv = AGENT_DIR_FILES.filter((f) => f.private).map((f) => f.name);
	assert.deepEqual(priv, ["auth.json", "models-store.json", "trust.json"]);
	assert.equal(AGENT_DIR_FILES.find((f) => f.name === "settings.json")?.private, false);
});

test("doctor 的输出里不会有任何值 —— 拿一组假值过一遍", () => {
	const env = Object.fromEntries(PROVIDER_ENV_KEYS.map((name) => [name, "VALUE-MUST-NOT-APPEAR"]));
	const rendered = JSON.stringify(checkCredentials(env));
	assert.ok(!rendered.includes("VALUE-MUST-NOT-APPEAR"));
	for (const name of PROVIDER_ENV_KEYS) assert.ok(rendered.includes(name));
});
