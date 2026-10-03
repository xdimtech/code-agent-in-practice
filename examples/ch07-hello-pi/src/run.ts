/**
 * 把"跑一次 pi"这件事变成可重复的一步：临时目录 + 离线 + 隔离的 agent 目录。
 *
 * 为什么要隔离 agent 目录：pi 会把凭据、会话、信任状态写进 agent 目录
 * （默认 `<home>/.pi/agent`）。例子要是用真的那份，跑一次就会往你的会话历史里
 * 塞东西，还可能读到你的凭据。这里用 `PI_CODING_AGENT_DIR` 指到临时目录
 * （config.ts:503-504 支持这个变量），跑完删掉。
 *
 * 为什么要 `PI_OFFLINE=1`：main.ts:564-568 见到它就设 `PI_SKIP_VERSION_CHECK=1`，
 * pi 不再去网上查新版本。这一章的例子全程不联网。
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunOptions {
	/** pi 可执行文件。默认 "pi"，走 PATH。 */
	readonly piBin?: string;
	/** 传给 pi 的参数。 */
	readonly args: readonly string[];
	/** 工作目录里预置的文件，路径 → 内容。 */
	readonly files?: Record<string, string>;
	/** 标准输入。默认关闭 stdin（`< /dev/null`），免得不小心进交互模式。 */
	readonly stdin?: string;
	readonly timeoutMs?: number;
	/** 额外的环境变量。 */
	readonly env?: Record<string, string>;
}

export interface RunResult {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly cwd: string;
	readonly agentDir: string;
	readonly timedOut: boolean;
}

/**
 * 在临时目录里跑一次 pi。目录由调用方用 `cleanup()` 清掉 —— 想看现场就留着。
 */
export interface Sandbox {
	readonly dir: string;
	readonly agentDir: string;
	readonly cwd: string;
	cleanup: () => void;
}

export function createSandbox(prefix = "ch07-pi-"): Sandbox {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	const cwd = join(dir, "proj");
	const agentDir = join(dir, "agent");
	// 两个目录都要先存在：pi 会往 agent 目录里写文件，不会替你建父目录。
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	return {
		dir,
		agentDir,
		cwd,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** 离线跑一次。默认参数就把 stdin 关掉。 */
export function runPi(sandbox: Sandbox, options: RunOptions): Promise<RunResult> {
	for (const [name, content] of Object.entries(options.files ?? {})) {
		writeFileSync(join(sandbox.cwd, name), content);
	}

	const env: Record<string, string> = {
		...process.env,
		PI_OFFLINE: "1",
		PI_SKIP_VERSION_CHECK: "1",
		PI_CODING_AGENT_DIR: sandbox.agentDir,
		...options.env,
	} as Record<string, string>;

	return new Promise((resolve) => {
		const child = spawn(options.piBin ?? "pi", [...options.args], {
			cwd: sandbox.cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let timer: NodeJS.Timeout | undefined;

		if (options.timeoutMs !== undefined) {
			timer = setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, options.timeoutMs);
		}

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => void (stdout += chunk));
		child.stderr.on("data", (chunk: string) => void (stderr += chunk));
		child.on("error", (error: Error) => {
			if (timer !== undefined) clearTimeout(timer);
			resolve({
				code: null,
				signal: null,
				stdout,
				stderr: `${stderr}${error.message}`,
				cwd: sandbox.cwd,
				agentDir: sandbox.agentDir,
				timedOut,
			});
		});
		child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			if (timer !== undefined) clearTimeout(timer);
			resolve({ code, signal, stdout, stderr, cwd: sandbox.cwd, agentDir: sandbox.agentDir, timedOut });
		});

		// 默认不给 stdin：`< /dev/null` 的效果。不给的话 pi 可能等输入。
		child.stdin.end(options.stdin ?? "");
	});
}
