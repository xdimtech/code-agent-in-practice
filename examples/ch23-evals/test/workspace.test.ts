import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import { listWorkspaceFiles, readWorkspaceFile, snapshot } from "../src/workspace.ts";
import type { ToolContext } from "../src/harness.ts";

function withWorkspace(run: (context: ToolContext) => void): void {
	const root = mkdtempSync(join(tmpdir(), "ch23-ws-"));
	const context: ToolContext = { cwd: join(root, "work"), root };
	try {
		mkdirSync(context.cwd, { recursive: true });
		run(context);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function touch(path: string, content = "x"): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content, "utf8");
}

test("列出的路径相对 cwd，不是绝对路径——临时目录名每次都变，写进产物就是噪声", () => {
	withWorkspace((context) => {
		touch(join(context.cwd, "package.json"));
		touch(join(context.cwd, "src", "hello.ts"));
		const files = listWorkspaceFiles(context);
		assert.deepEqual(files, ["package.json", "src/hello.ts"]);
		assert.equal(files.some((path) => path.startsWith("/")), false);
	});
});

test("越界的文件用 ../ 显示出来：这是断言认得出的形状", () => {
	withWorkspace((context) => {
		touch(join(context.root, "build", "output.txt"));
		assert.deepEqual(listWorkspaceFiles(context), ["../build/output.txt"]);
	});
});

test("cwd 自己不算文件，只列里面的东西", () => {
	withWorkspace((context) => {
		assert.deepEqual(listWorkspaceFiles(context), []);
		touch(join(context.cwd, "a.txt"));
		assert.deepEqual(listWorkspaceFiles(context), ["a.txt"]);
	});
});

test("跳过 node_modules 和 .git：它们不是这次运行产生的", () => {
	withWorkspace((context) => {
		touch(join(context.cwd, "node_modules", "dep", "index.js"));
		touch(join(context.cwd, ".git", "HEAD"));
		touch(join(context.cwd, "index.ts"));
		assert.deepEqual(listWorkspaceFiles(context), ["index.ts"]);
	});
});

test("结果排序，两次运行的列表能直接字符串比", () => {
	withWorkspace((context) => {
		for (const name of ["c.txt", "a.txt", "b.txt"]) touch(join(context.cwd, name));
		assert.deepEqual(listWorkspaceFiles(context), ["a.txt", "b.txt", "c.txt"]);
	});
});

test("读文件读得到，读不到的时候返回 undefined 而不是抛", () => {
	withWorkspace((context) => {
		touch(join(context.cwd, "a.txt"), "内容");
		const read = readWorkspaceFile(context);
		assert.equal(read("a.txt"), "内容");
		assert.equal(read("missing.txt"), undefined);
	});
});

test("越界的路径读不了：给的是 undefined，不是沙箱外的文件内容", () => {
	withWorkspace((context) => {
		touch(join(context.root, "..", "outside-ch23.txt"), "不该被读到");
		const read = readWorkspaceFile(context);
		assert.equal(read(`../${relative(context.root, join(context.root, "..", "outside-ch23.txt"))}`), undefined);
	});
});

test("目录不当文件读", () => {
	withWorkspace((context) => {
		mkdirSync(join(context.cwd, "src"));
		assert.equal(readWorkspaceFile(context)("src"), undefined);
	});
});

test("snapshot 把 files 放进去，额外的键并进来", () => {
	withWorkspace((context) => {
		touch(join(context.cwd, "a.txt"));
		assert.deepEqual(snapshot(context, { source: "内容" }), { files: ["a.txt"], source: "内容" });
	});
});
