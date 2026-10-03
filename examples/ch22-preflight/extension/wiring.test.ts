import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { ExecOptions, Operations, SpawnContext } from "../src/env-filter.ts";
import type { RejectionTarget } from "../src/crash.ts";
import { installPreflight, REFUSED_EXIT_CODE, type Ctx, type PiLike, type PreflightDeps, type ToolCallHandler, type UserBashHandler } from "./wiring.ts";

type Handler = (event: never, ctx: Ctx) => unknown;

/** 记下注册了什么的假 pi */
function fakePi() {
	const handlers: Record<string, Handler[]> = {};
	const tools: unknown[] = [];
	const commands: Record<string, (args: string, ctx: Ctx) => Promise<void>> = {};
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers[event] = [...(handlers[event] ?? []), handler];
		},
		registerTool: (definition: unknown) => {
			tools.push(definition);
		},
		registerCommand: (name: string, options: { handler: (args: string, ctx: Ctx) => Promise<void> }) => {
			commands[name] = options.handler;
		},
	} as unknown as PiLike;
	return { pi, handlers, tools, commands };
}

function fakeCtx() {
	const notes: string[] = [];
	let aborted = 0;
	const ctx: Ctx = {
		hasUI: true,
		ui: { notify: (message) => void notes.push(message), confirm: async () => true },
		abort: () => void aborted++,
	};
	return { ctx, notes, aborted: () => aborted };
}

const ENV = { PATH: "/usr/bin", HOME: "/h", GITHUB_TOKEN: "<placeholder>", DATABASE_URL: "<placeholder>" };

function setup(overrides: Partial<PreflightDeps> = {}) {
	const fake = fakePi();
	const seen: ExecOptions[] = [];
	const opsOptions: { shellPath?: string }[] = [];
	const inner: Operations = { exec: async (_c, _w, options) => (seen.push(options), { exitCode: 0 }) };
	const emitter = new EventEmitter();
	const deps: PreflightDeps = {
		cwd: "/work",
		createBashToolDefinition: (cwd, options) => ({ name: "bash", cwd, ...options }),
		createLocalBashOperations: (options) => (opsOptions.push(options), inner),
		baseEnv: () => ENV,
		process: emitter as unknown as RejectionTarget,
		runtime: "node",
		installFacts: () => ({ env: {} }),
		limits: { maxTurns: 3, maxRepeats: 2 },
		...overrides,
	};
	const preflight = installPreflight(fake.pi, deps);
	return { ...fake, preflight, seen, emitter, opsOptions };
}

const callTool = async (handlers: Record<string, Handler[]>, event: unknown, ctx: Ctx) => {
	for (const handler of handlers.tool_call ?? []) {
		const result = (await (handler as ToolCallHandler)(event as never, ctx)) as { block?: boolean } | undefined;
		if (result?.block) return result;
	}
	return undefined;
};

/** 照 runner.ts:1005-1032：第一个非空结果胜出 */
const userBash = async (handlers: Record<string, Handler[]>, event: unknown, ctx: Ctx) => {
	for (const handler of handlers.user_bash ?? []) {
		const result = await (handler as UserBashHandler)(event as never, ctx);
		if (result) return result;
	}
	return undefined;
};

test("刹车：超过 maxRepeats 的那一次被拦，带 terminate", async () => {
	const { handlers } = setup();
	const { ctx } = fakeCtx();
	const event = { toolName: "bash", input: { command: "npm test" } };
	assert.equal(await callTool(handlers, event, ctx), undefined);
	assert.equal(await callTool(handlers, event, ctx), undefined);
	const blocked = await callTool(handlers, event, ctx);
	assert.equal(blocked?.block, true);
	assert.deepEqual(Object.keys(blocked ?? {}).sort(), ["block", "reason", "terminate"]);
});

test("agent_start 清零", async () => {
	const { handlers, preflight } = setup();
	const { ctx } = fakeCtx();
	await callTool(handlers, { toolName: "bash", input: { command: "ls" } }, ctx);
	assert.equal(Object.keys(preflight.state().counts).length, 1);
	for (const h of handlers.agent_start ?? []) h(undefined as never, ctx);
	assert.equal(Object.keys(preflight.state().counts).length, 0);
});

test("turn_end 到上限：提示并 abort", () => {
	const { handlers } = setup();
	const probe = fakeCtx();
	const [turnEnd] = handlers.turn_end ?? [];
	for (let i = 0; i < 3; i++) turnEnd?.(undefined as never, probe.ctx);
	assert.equal(probe.aborted(), 1);
	assert.match(probe.notes[0] ?? "", /3 轮/);
});

test("顺序：刹车排在确认前面，被拦的调用不再问确认", async () => {
	let asked = 0;
	const { handlers } = setup({ toolCallGate: () => (asked++, undefined) });
	const { ctx } = fakeCtx();
	const event = { toolName: "bash", input: { command: "npm test" } };
	for (let i = 0; i < 3; i++) await callTool(handlers, event, ctx);
	assert.equal(handlers.tool_call?.length, 2);
	assert.equal(asked, 2);
});

test("确认拒绝时 tool_call 返回它的结果", async () => {
	const { handlers } = setup({ toolCallGate: () => ({ block: true, reason: "用户没有同意" }) });
	const { ctx } = fakeCtx();
	assert.deepEqual(await callTool(handlers, { toolName: "write", input: { path: ".env" } }, ctx), { block: true, reason: "用户没有同意" });
});

test("覆盖 bash 工具：spawnHook 过滤环境", () => {
	const { tools } = setup();
	assert.equal(tools.length, 1);
	const tool = tools[0] as { name: string; cwd: string; spawnHook: (c: SpawnContext) => SpawnContext };
	assert.equal(tool.name, "bash");
	assert.equal(tool.cwd, "/work");
	assert.deepEqual(Object.keys(tool.spawnHook({ command: "env", cwd: "/work", env: ENV }).env).sort(), ["HOME", "PATH"]);
});

test("用户设置的 shell 和命令前缀原样带给覆盖后的 bash 与 `!`", () => {
	const { tools, opsOptions } = setup({ shell: { shellPath: "/bin/zsh", commandPrefix: "shopt -s expand_aliases" } });
	const tool = tools[0] as { shellPath?: string; commandPrefix?: string };
	assert.equal(tool.shellPath, "/bin/zsh");
	assert.equal(tool.commandPrefix, "shopt -s expand_aliases");
	assert.deepEqual(opsOptions, [{ shellPath: "/bin/zsh" }]);
});

test("user_bash：只有一个处理器；放行时返回过滤过的 operations", async () => {
	const { handlers, seen } = setup({ userBashGate: () => undefined });
	const { ctx } = fakeCtx();
	assert.equal(handlers.user_bash?.length, 1);
	const result = await userBash(handlers, { command: "env", cwd: "/work" }, ctx);
	assert.ok(result?.operations);
	await result.operations.exec("env", "/work", { onData: () => {} });
	assert.deepEqual(seen[0]?.env, { HOME: "/h", PATH: "/usr/bin" });
});

test("user_bash：确认拒绝时返回它的结果，不给 operations", async () => {
	const denied = { result: { output: "拒绝", exitCode: REFUSED_EXIT_CODE, cancelled: false, truncated: false } };
	const { handlers } = setup({ userBashGate: () => denied });
	const { ctx } = fakeCtx();
	assert.deepEqual(await userBash(handlers, { command: "rm -rf /", cwd: "/work" }, ctx), denied);
});

test("user_bash：确认自己抛错时按拒绝处理，不让宿主用全量环境执行", async () => {
	const { handlers } = setup({
		userBashGate: () => {
			throw new Error("配置坏了");
		},
	});
	const { ctx } = fakeCtx();
	const result = (await userBash(handlers, { command: "ls", cwd: "/work" }, ctx)) as { result?: { exitCode: number; output: string }; operations?: unknown };
	assert.equal(result.operations, undefined);
	assert.equal(result.result?.exitCode, REFUSED_EXIT_CODE);
	assert.match(result.result?.output ?? "", /配置坏了/);
});

test("崩溃兜底：装上一个 unhandledRejection，uninstall 摘掉", () => {
	const { emitter, preflight } = setup();
	assert.equal(emitter.listenerCount("unhandledRejection"), 1);
	assert.throws(() => emitter.emit("unhandledRejection", "boom"), /boom/);
	preflight.uninstall();
	assert.equal(emitter.listenerCount("unhandledRejection"), 0);
});

test("facts：没给确认就报缺，安装脚本看注入的事实", () => {
	const bare = setup().preflight.facts();
	assert.deepEqual(bare.confirm, { toolCall: false, userBash: false, isolated: false });
	assert.equal(bare.installScripts.kind, "runs");
	const full = setup({ toolCallGate: () => undefined, userBashGate: () => undefined, isolated: true, installFacts: () => ({ npmCommand: ["npm", "--ignore-scripts"], env: {} }) }).preflight.facts();
	assert.deepEqual(full.confirm, { toolCall: true, userBash: true, isolated: true });
	assert.equal(full.installScripts.kind, "skipped");
});

test("/preflight：有界面走 notify，内容是清单", async () => {
	const { commands } = setup();
	const probe = fakeCtx();
	await commands.preflight?.("", probe.ctx);
	assert.equal(probe.notes.length, 1);
	assert.match(probe.notes[0] ?? "", /✓ 必补  刹车/);
	assert.match(probe.notes[0] ?? "", /✗ 必补  确认/);
});
