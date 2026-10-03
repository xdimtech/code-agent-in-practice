import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { installRejectionFallback, isScenario, runtimeOf, SCENARIOS, toError, type RejectionTarget } from "./crash.ts";

const PROBE = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "probe.ts");

test("toError：Error 原样，字符串包一层，其他值只报类型不展开", () => {
	const original = new Error("x");
	assert.equal(toError(original), original);
	assert.equal(toError("boom").message, "boom");
	assert.match(toError(undefined).message, /undefined/);
	assert.match(toError(null).message, /null/);
	const secret = toError({ token: "<placeholder>" });
	assert.match(secret.message, /Object/);
	assert.ok(!secret.message.includes("placeholder"));
	assert.match(toError(42).message, /number/);
	assert.match(toError(new Map()).message, /Map/);
});

test("installRejectionFallback：挂上的监听器会抛，撤销后摘掉", () => {
	const emitter = new EventEmitter();
	const uninstall = installRejectionFallback(emitter as unknown as RejectionTarget);
	assert.equal(emitter.listenerCount("unhandledRejection"), 1);
	assert.throws(() => emitter.emit("unhandledRejection", new Error("boom")), /boom/);
	uninstall();
	assert.equal(emitter.listenerCount("unhandledRejection"), 0);
});

test("runtimeOf 看 versions.bun", () => {
	assert.equal(runtimeOf({ node: "22.0.0" }), "node");
	assert.equal(runtimeOf({ node: "22.0.0", bun: "1.3.14" }), "bun");
});

test("isScenario 只认四个场景", () => {
	assert.ok(SCENARIOS.every(isScenario));
	assert.equal(isScenario("other"), false);
	assert.equal(isScenario(undefined), false);
});

const probe = (scenario: string) =>
	spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", PROBE, scenario], { encoding: "utf8" });

test("Node 下四个场景的落点", { skip: runtimeOf(process.versions) === "bun" }, () => {
	const expected: Record<string, string> = {
		"pi-only": "caught boom",
		swallowed: "alive",
		fallback: "caught boom",
		"swallowed+fallback": "caught boom",
	};
	for (const scenario of SCENARIOS) {
		const result = probe(scenario);
		assert.equal(result.stdout.trim(), expected[scenario], scenario);
		assert.equal(result.status, 0, scenario);
	}
});

test("probe：不认识的场景退出码 2", () => {
	assert.equal(probe("nope").status, 2);
});
