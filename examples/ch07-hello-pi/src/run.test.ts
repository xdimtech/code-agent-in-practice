import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createSandbox, runPi } from "./run.ts";

test("沙箱：工作目录和 agent 目录都建好了，在临时目录下", () => {
	const sandbox = createSandbox();
	try {
		assert.equal(existsSync(sandbox.cwd), true);
		assert.equal(existsSync(sandbox.agentDir), true);
		assert.ok(sandbox.dir.startsWith("/"));
		assert.notEqual(sandbox.cwd, sandbox.agentDir);
	} finally {
		sandbox.cleanup();
	}
});

test("cleanup 之后目录没了", () => {
	const sandbox = createSandbox();
	const dir = sandbox.dir;
	sandbox.cleanup();
	assert.equal(existsSync(dir), false);
});

test("预置文件写进工作目录，不是 agent 目录", async () => {
	const sandbox = createSandbox();
	try {
		await runPi(sandbox, { piBin: "/bin/echo", args: ["ok"], files: { "a.txt": "hello\n" } });
		assert.equal(readFileSync(`${sandbox.cwd}/a.txt`, "utf8"), "hello\n");
		assert.equal(existsSync(`${sandbox.agentDir}/a.txt`), false);
	} finally {
		sandbox.cleanup();
	}
});

test("环境变量：离线开着，agent 目录指向沙箱", async () => {
	const sandbox = createSandbox();
	try {
		// 用 sh 把环境打出来，避免依赖任何真实二进制。
		const result = await runPi(sandbox, { piBin: "/bin/sh", args: ["-c", "echo $PI_OFFLINE $PI_SKIP_VERSION_CHECK $PI_CODING_AGENT_DIR"] });
		const [offline, skip, agentDir] = result.stdout.trim().split(" ");
		assert.equal(offline, "1");
		assert.equal(skip, "1");
		assert.equal(agentDir, sandbox.agentDir);
	} finally {
		sandbox.cleanup();
	}
});

test("extra env 能覆盖默认值", async () => {
	const sandbox = createSandbox();
	try {
		const result = await runPi(sandbox, { piBin: "/bin/sh", args: ["-c", "echo $PI_DEMO_FILE"], env: { PI_DEMO_FILE: "other.txt" } });
		assert.equal(result.stdout.trim(), "other.txt");
	} finally {
		sandbox.cleanup();
	}
});

test("标准输入默认是空的，不等输入", async () => {
	const sandbox = createSandbox();
	try {
		const result = await runPi(sandbox, { piBin: "/bin/cat", args: [] });
		assert.equal(result.code, 0);
		assert.equal(result.stdout, "");
	} finally {
		sandbox.cleanup();
	}
});

test("给了 stdin 就能读到", async () => {
	const sandbox = createSandbox();
	try {
		const result = await runPi(sandbox, { piBin: "/bin/cat", args: [], stdin: "hello" });
		assert.equal(result.stdout, "hello");
	} finally {
		sandbox.cleanup();
	}
});

test("退出码原样带回来", async () => {
	const sandbox = createSandbox();
	try {
		assert.equal((await runPi(sandbox, { piBin: "/bin/sh", args: ["-c", "exit 3"] })).code, 3);
	} finally {
		sandbox.cleanup();
	}
});

test("stderr 单独收，不和 stdout 混", async () => {
	const sandbox = createSandbox();
	try {
		const result = await runPi(sandbox, { piBin: "/bin/sh", args: ["-c", "echo out; echo err 1>&2"] });
		assert.equal(result.stdout.trim(), "out");
		assert.equal(result.stderr.trim(), "err");
	} finally {
		sandbox.cleanup();
	}
});

test("跑不动：不抛错，退出码是 null，消息进 stderr", async () => {
	const sandbox = createSandbox();
	try {
		const result = await runPi(sandbox, { piBin: "/definitely/not/a/binary", args: [] });
		assert.equal(result.code, null);
		assert.match(result.stderr, /ENOENT|not found|no such file/i);
	} finally {
		sandbox.cleanup();
	}
});

test("超时：杀掉子进程并标出来", async () => {
	const sandbox = createSandbox();
	try {
		const result = await runPi(sandbox, { piBin: "/bin/sh", args: ["-c", "sleep 30"], timeoutMs: 200 });
		assert.equal(result.timedOut, true);
		assert.equal(result.signal, "SIGKILL");
	} finally {
		sandbox.cleanup();
	}
});
