import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import { authorWeeks, countLines, countSourceLines, inScope, measureRepo, parseNumstat } from "../src/measure.ts";

test("inScope：只数 src 下的 .ts/.tsx，去掉测试和 examples", () => {
	assert.equal(inScope("packages/a/src/x.ts"), true);
	assert.equal(inScope("packages/a/src/x.tsx"), true);
	assert.equal(inScope("packages/a/lib/x.ts"), false);
	assert.equal(inScope("packages/a/src/x.test.ts"), false);
	assert.equal(inScope("packages/a/src/tests/x.ts"), false);
	assert.equal(inScope("packages/a/examples/src/x.ts"), false);
	assert.equal(inScope("packages/a/src/x.js"), false);
});

test("countLines：和 wc -l 一样数换行，末行没换行补一", () => {
	assert.equal(countLines(""), 0);
	assert.equal(countLines("a"), 1);
	assert.equal(countLines("a\n"), 1);
	assert.equal(countLines("a\nb"), 2);
});

test("parseNumstat：按 commit 分组，跳过二进制和口径外文件", () => {
	const text = ["@aaa", "", "10\t2\tpkg/src/a.ts", "5\t5\tREADME.md", "-\t-\tpkg/src/img.ts", "@bbb", "", "3\t1\tpkg/src/b.ts"].join("\n");
	assert.deepEqual(parseNumstat(text), [
		{ added: 10, deleted: 2 },
		{ added: 3, deleted: 1 },
	]);
});

test("authorWeeks：作者 × 周去重，bot 账号不算", () => {
	const lines = ["Ann\ta@x\t2026-36", "Ann\ta@x\t2026-36", "Ann\ta@x\t2026-37", "github-actions[bot]\tb@x\t2026-36", "renovatebot\tc@x\t2026-36"];
	assert.equal(authorWeeks(lines), 2);
});

const repo = mkdtempSync(join(tmpdir(), "ch06-measure-"));
after(() => rmSync(repo, { recursive: true, force: true }));

function sh(...args: string[]) {
	const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-09-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-09-01T00:00:00Z" } });
	assert.equal(r.status, 0, r.stderr);
}
function put(path: string, text: string) {
	mkdirSync(dirname(join(repo, path)), { recursive: true });
	writeFileSync(join(repo, path), text);
}

test("在一个临时 git 仓库上量：行数、commit、作者、最大单次新增", () => {
	sh("init", "-q");
	sh("config", "user.name", "Ann");
	sh("config", "user.email", "ann@example.com");
	put("pkg/src/a.ts", "1\n2\n3\n");
	put("pkg/src/a.test.ts", "x\n");
	put("README.md", "r\n");
	sh("add", ".");
	sh("commit", "-qm", "first");
	put("pkg/src/b.ts", "1\n2");
	put("pkg/src/a.ts", "1\n3\n");
	sh("add", ".");
	sh("commit", "-qm", "second");

	assert.deepEqual(countSourceLines(repo), { files: 2, lines: 4 });
	const m = measureRepo(repo, "tmp");
	assert.equal(m.name, "tmp");
	assert.equal(m.lines, 4);
	assert.equal(m.commits, 2);
	assert.equal(m.authors, 1);
	assert.equal(m.authorWeeks, 1);
	assert.equal(m.firstDay, "2026-09-01");
	assert.equal(m.largestImportLines, 3);
	assert.equal(m.added, 3 + 2);
	assert.equal(m.deleted, 1);
});

test("不是 git 仓库：报错带上 git 的原因", () => {
	const empty = mkdtempSync(join(tmpdir(), "ch06-nogit-"));
	try {
		assert.throws(() => measureRepo(empty, "x"), /git rev-parse 失败/);
	} finally {
		rmSync(empty, { recursive: true, force: true });
	}
});
