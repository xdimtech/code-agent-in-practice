import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAgentFiles, checkCredentials, checkEnvFlags, checkNode, compareVersions, defaultAgentDir, renderChecks, runChecks, worstLevel, type DoctorInput } from "./doctor.ts";

const base: DoctorInput = {
	nodeVersion: "22.22.3",
	agentDir: "/home/u/.pi/agent",
	env: {},
	statFile: () => undefined,
};

test("版本比较只看前三段", () => {
	assert.equal(compareVersions("22.19.0", [22, 19, 0]), 0);
	assert.equal(compareVersions("v22.18.9", [22, 19, 0]), -1);
	assert.equal(compareVersions("23.0.0", [22, 19, 0]), 1);
	assert.equal(compareVersions("22.22.3", [22, 19, 0]), 1);
});

test("Node 版本：够了是 ok，不够是 fail，并写出处", () => {
	assert.equal(checkNode("22.22.3").level, "ok");
	const bad = checkNode("20.11.0");
	assert.equal(bad.level, "fail");
	assert.match(bad.detail, /22\.19\.0/);
	assert.match(bad.detail, /package\.json:103-104/);
});

test("边界：正好等于下限算够", () => {
	assert.equal(checkNode("22.19.0").level, "ok");
	assert.equal(checkNode("22.18.99").level, "fail");
});

test("agent 目录：默认位置和覆盖过的位置，说法不一样", () => {
	assert.match(runChecks(base).find((c) => c.name === "agent 目录")?.detail ?? "", /config\.ts:529/);
	const overridden = runChecks({ ...base, agentDirEnvVar: "PI_CODING_AGENT_DIR" });
	assert.match(overridden.find((c) => c.name === "agent 目录")?.detail ?? "", /PI_CODING_AGENT_DIR/);
});

test("agent 文件：不存在是 ok，权限不对是 warn", () => {
	const missing = checkAgentFiles(base);
	assert.equal(missing.length, 4);
	assert.ok(missing.every((c) => c.level === "ok"));

	const wrong = checkAgentFiles({ ...base, statFile: (p) => (p.endsWith("auth.json") ? { mode: 0o644 } : undefined) });
	const auth = wrong.find((c) => c.name === "auth.json");
	assert.equal(auth?.level, "warn");
	assert.match(auth?.detail ?? "", /权限是 644/);
	assert.match(auth?.detail ?? "", /凭据/);
});

test("agent 文件：600 就 ok，settings.json 不是私有的", () => {
	const checks = checkAgentFiles({ ...base, statFile: () => ({ mode: 0o600 }) });
	assert.ok(checks.every((c) => c.level === "ok"));
	assert.equal(checks.find((c) => c.name === "settings.json")?.detail, "在，权限 600");
});

test("凭据：只报名字，绝不报值", () => {
	const none = checkCredentials({});
	assert.equal(none[0].level, "warn");
	assert.ok(!none[0].detail.includes("="));

	const some = checkCredentials({ OPENAI_API_KEY: "sekrit-value", ANTHROPIC_API_KEY: "another" });
	assert.equal(some[0].level, "ok");
	assert.match(some[0].detail, /OPENAI_API_KEY/);
	assert.ok(!some[0].detail.includes("sekrit-value"), "值不能出现在输出里");
	assert.ok(!some[0].detail.includes("another"));
});

test("凭据：空字符串不算设了", () => {
	assert.equal(checkCredentials({ OPENAI_API_KEY: "" })[0].level, "warn");
});

test("环境开关：报了哪些，不报值", () => {
	assert.equal(checkEnvFlags({}).detail, "一个都没设");
	const flags = checkEnvFlags({ PI_OFFLINE: "1", PI_TELEMETRY: "0" });
	assert.match(flags.detail, /PI_OFFLINE/);
	assert.match(flags.detail, /PI_TELEMETRY/);
	assert.ok(!flags.detail.includes("1"));
});

test("退出码取最严重的一项", () => {
	assert.equal(worstLevel([{ level: "ok", name: "a", detail: "" }, { level: "warn", name: "b", detail: "" }]), "warn");
	assert.equal(worstLevel([{ level: "warn", name: "b", detail: "" }, { level: "fail", name: "c", detail: "" }]), "fail");
	assert.equal(worstLevel([]), "ok");
});

test("渲染：warn 有改进提示，fail 有必须先解决的提示", () => {
	assert.match(renderChecks([{ level: "warn", name: "x", detail: "d" }]), /可以改进/);
	assert.match(renderChecks([{ level: "fail", name: "x", detail: "d" }]), /必须先解决/);
	assert.match(renderChecks([{ level: "ok", name: "x", detail: "d" }]), /没发现问题/);
});

test("默认 agent 目录：环境变量优先", () => {
	assert.deepEqual(defaultAgentDir("/home/u", {}), { agentDir: "/home/u/.pi/agent" });
	assert.deepEqual(defaultAgentDir("/home/u", { PI_CODING_AGENT_DIR: "/tmp/a" }), { agentDir: "/tmp/a", envVar: "PI_CODING_AGENT_DIR" });
	assert.deepEqual(defaultAgentDir("/home/u", { PI_CODING_AGENT_DIR: "" }), { agentDir: "/home/u/.pi/agent" });
});
