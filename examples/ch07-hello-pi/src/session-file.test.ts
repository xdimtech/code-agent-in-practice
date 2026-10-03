import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { newestSession, readSessionFile, readSessions, renderSessionSummary, resolveCwd, sessionDirName, sessionDirPath } from "./session-file.ts";

test("目录名规则照抄 core/session-manager.ts:476-479", () => {
	assert.equal(sessionDirName("/Users/u/proj"), "--Users-u-proj--");
	assert.equal(sessionDirName("/private/tmp/x"), "--private-tmp-x--");
	// 反斜杠和冒号都换成横杠：`C:\\a\\b` 的前两段替换后是 `C--a-b`。
	assert.equal(sessionDirName("C:\\a\\b"), "--C--a-b--");
	assert.equal(sessionDirPath("/h/.pi/agent", "/w"), "/h/.pi/agent/sessions/--w--");
});

const dir = mkdtempSync(join(tmpdir(), "ch07-session-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("目录不存在：不是错误，就是空", () => {
	const summary = readSessions(join(dir, "nope"), "/w");
	assert.equal(summary.dirExists, false);
	assert.deepEqual(summary.sessions, []);
	assert.equal(newestSession(summary), undefined);
	assert.match(renderSessionSummary(summary), /还没有/);
});

test("列出会话文件，按名字排序，最新的是最后一个", () => {
	const agentDir = join(dir, "agent");
	const sessions = join(sessionDirPath(agentDir, "/w"));
	mkdirSync(sessions, { recursive: true });
	writeFileSync(join(sessions, "2026-10-01T00-00-00_a.jsonl"), '{"type":"session"}\n');
	writeFileSync(join(sessions, "2026-10-02T00-00-00_b.jsonl"), '{"type":"session"}\n{"type":"agent_start"}\n');
	writeFileSync(join(sessions, "notes.txt"), "ignored\n");

	const summary = readSessions(agentDir, "/w");
	assert.equal(summary.dirExists, true);
	assert.deepEqual(summary.sessions.map((s) => s.name), ["2026-10-01T00-00-00_a.jsonl", "2026-10-02T00-00-00_b.jsonl"]);
	assert.equal(newestSession(summary)?.name, "2026-10-02T00-00-00_b.jsonl");
	assert.equal(summary.sessions[1].lines, 2);
	assert.match(renderSessionSummary(summary), /2 条记录/);
});

test("读会话文件：坏行不抛错", () => {
	const path = join(dir, "mixed.jsonl");
	writeFileSync(path, '{"type":"session"}\n\nnot json\n123\n');
	const records = readSessionFile(path);
	assert.deepEqual(records.map((r) => r.type), ["session", "（不是 JSON）", "（不是对象）"]);
	assert.equal(readFileSync(path, "utf8").includes("not json"), true);
});

test("先解析符号链接：macOS 的 /tmp 是 /private/tmp", () => {
	// 不解析的话，目录名会差一段，看起来像"会话丢了"。
	const resolved = resolveCwd("/tmp");
	if (existsSync("/private/tmp")) assert.equal(resolved, "/private/tmp");
	// mkdtemp 给的临时目录自己也常带一层符号链接（macOS 上是 /var → /private/var）。
	assert.equal(resolveCwd(resolveCwd(dir)), resolveCwd(dir), "真路径再解析一次不变");
	assert.equal(resolveCwd(join(dir, "不存在")), join(dir, "不存在"), "不存在也不抛错");
});
