/**
 * 把四件必补接到 pi 上。依赖全部注入，测试里用假的 pi 和假的工具工厂。
 *
 * 唯一 import pi 的是 extension/preflight.ts；这个文件不带任何依赖。
 *
 * 顺序上有两处要当心，都来自 pi 怎么分发事件（core/extensions/runner.ts）：
 *
 *   - tool_call：按扩展加载顺序逐个调用，第一个 block 就返回（:983-1003）。
 *     刹车排在确认前面：重复到第四次的调用直接拦下，不再弹确认框问用户。
 *   - user_bash：第一个返回非空结果的处理器胜出，后面的不再调用（:1005-1032）。
 *     所以 `!` 上的确认和凭据过滤必须写在同一个处理器里：先问确认，放行了再返回包过的 operations。
 *     分成两个处理器的话，凭据那个一旦排在前面，确认就永远轮不到。
 */

import { installRejectionFallback, type RejectionTarget, type Runtime } from "../src/crash.ts";
import { DEFAULT_ENV_POLICY, envSpawnHook, wrapOperations, type Env, type EnvPolicy, type Operations, type SpawnContext } from "../src/env-filter.ts";
import { evaluate, render, type Facts } from "../src/checklist.ts";
import { installScriptStatus, type InstallFacts } from "../src/install-scripts.ts";
import { DEFAULT_LIMITS, initialState, onToolCall, onTurnEnd, type GuardLimits, type GuardState } from "../src/loop-guard.ts";

// ── pi 那一侧，只取用得到的形状 ─────────────────────────────────────────

export interface Ctx {
	readonly hasUI: boolean;
	readonly ui: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		confirm(title: string, message: string): Promise<boolean>;
	};
	abort(): void;
}

export interface ToolCallEvent {
	readonly toolName: string;
	readonly input: Record<string, unknown>;
}
export interface ToolCallResult {
	readonly block?: boolean;
	readonly reason?: string;
	readonly terminate?: boolean;
}
export type ToolCallHandler = (event: ToolCallEvent, ctx: Ctx) => Promise<ToolCallResult | undefined> | ToolCallResult | undefined;

export interface UserBashEvent {
	readonly command: string;
	readonly cwd: string;
}
export interface UserBashResult {
	readonly operations?: Operations;
	readonly result?: unknown;
}
export type UserBashHandler = (event: UserBashEvent, ctx: Ctx) => Promise<UserBashResult | undefined> | UserBashResult | undefined;

export interface PiLike {
	on(event: "agent_start", handler: (event: unknown, ctx: Ctx) => void): void;
	on(event: "tool_call", handler: ToolCallHandler): void;
	on(event: "turn_end", handler: (event: unknown, ctx: Ctx) => void): void;
	on(event: "user_bash", handler: UserBashHandler): void;
	registerTool(definition: unknown): void;
	registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: Ctx) => Promise<void> }): void;
}

/** core/tools/bash.ts:198-209 的 BashToolOptions，只取用得到的字段 */
export interface BashToolOptions {
	readonly shellPath?: string;
	readonly commandPrefix?: string;
	readonly spawnHook: (context: SpawnContext) => SpawnContext;
}

export interface PreflightDeps {
	readonly cwd: string;
	/** pi 的 createBashToolDefinition（src/index.ts:289） */
	readonly createBashToolDefinition: (cwd: string, options: BashToolOptions) => unknown;
	/** pi 的 createLocalBashOperations（src/index.ts:293） */
	readonly createLocalBashOperations: (options: { shellPath?: string }) => Operations;
	/**
	 * 用户在设置里配的 shell 和命令前缀。pi 造内置 bash 时会带上（core/agent-session.ts:2774），
	 * 覆盖之后得由我们带上，不然用户的设置被悄悄丢掉
	 */
	readonly shell?: { readonly shellPath?: string; readonly commandPrefix?: string };
	readonly baseEnv: () => Env;
	readonly process: RejectionTarget;
	readonly runtime: Runtime;
	readonly installFacts: () => InstallFacts;
	readonly limits?: GuardLimits;
	readonly envPolicy?: EnvPolicy;
	/** 第 15 章的两个适配器；不给就是没有确认 */
	readonly toolCallGate?: ToolCallHandler;
	readonly userBashGate?: UserBashHandler;
	/** 命令是否跑在容器 / 虚拟机里。只影响清单上的措辞 */
	readonly isolated?: boolean;
}

/** 与第 15 章 hooks.ts 同一个约定：126 是「找到了命令但不许执行」 */
export const REFUSED_EXIT_CODE = 126;

/** pi 的 BashResult（core/bash-executor.ts:29-40）里必填的几项 */
const refusal = (reason: string) => ({ output: reason, exitCode: REFUSED_EXIT_CODE, cancelled: false, truncated: false });

export interface Preflight {
	readonly state: () => GuardState;
	readonly facts: () => Facts;
	readonly uninstall: () => void;
}

export function installPreflight(pi: PiLike, deps: PreflightDeps): Preflight {
	const limits = deps.limits ?? DEFAULT_LIMITS;
	const policy = deps.envPolicy ?? DEFAULT_ENV_POLICY;
	let state = initialState();

	// 一 · 刹车
	pi.on("agent_start", () => {
		state = initialState();
	});
	pi.on("tool_call", (event) => {
		const step = onToolCall(state, limits, event.toolName, event.input);
		state = step.state;
		if (step.verdict.kind === "allow") return undefined;
		return { block: true, reason: step.verdict.reason, terminate: true };
	});
	pi.on("turn_end", (_event, ctx) => {
		const step = onTurnEnd(state, limits);
		state = step.state;
		if (!step.stop) return;
		if (ctx.hasUI) ctx.ui.notify(`preflight：${step.reason}，已中止`, "warning");
		ctx.abort();
	});

	// 二 · 确认（模型那条路）。排在刹车后面，见文件头
	if (deps.toolCallGate) pi.on("tool_call", deps.toolCallGate);

	// 三 · 凭据（模型那条路）：同名注册即覆盖内置 bash（docs/extensions.md:2080）
	pi.registerTool(deps.createBashToolDefinition(deps.cwd, { ...deps.shell, spawnHook: envSpawnHook(policy) }));

	// 二 + 三（用户那条路）：必须是同一个处理器。
	// 这里抛出的错误会被宿主吞掉、照常用全量环境执行（runner.ts:1018-1027），所以自己接住，按拒绝处理
	// 命令前缀不用管：`!` 的前缀由 pi 在调 operations 之前拼好（core/agent-session.ts:2985-2987）
	const filtered = wrapOperations(deps.createLocalBashOperations({ shellPath: deps.shell?.shellPath }), deps.baseEnv, policy);
	const gate = deps.userBashGate;
	pi.on("user_bash", async (event, ctx) => {
		try {
			const verdict = gate ? await gate(event, ctx) : undefined;
			return verdict ?? { operations: filtered };
		} catch (error) {
			return { result: refusal(`preflight 自己出错了，按拒绝处理：${error instanceof Error ? error.message : String(error)}`) };
		}
	});

	// 五 · 崩溃收尾
	const uninstallFallback = installRejectionFallback(deps.process);

	const facts = (): Facts => ({
		loopGuard: { repeatBlock: true, turnCeiling: true },
		confirm: { toolCall: deps.toolCallGate !== undefined, userBash: gate !== undefined, isolated: deps.isolated ?? false },
		credentials: { bashTool: true, userBash: true },
		installScripts: installScriptStatus(deps.installFacts()),
		crash: { runtime: deps.runtime, fallback: true },
	});

	pi.registerCommand("preflight", {
		description: "上线前必补清单：哪几件补上了",
		handler: async (_args, ctx) => {
			const report = render(evaluate(facts()));
			if (ctx.hasUI) ctx.ui.notify(report, "info");
			else console.log(report);
		},
	});

	return { state: () => state, facts, uninstall: uninstallFallback };
}
