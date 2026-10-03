/**
 * 必补第三件：凭据不进子进程。
 *
 * pi 给子进程的环境从 getShellEnv() 起步：`{ ...process.env, PATH }`（utils/shell.ts:138-150），
 * 也就是启动 pi 时 shell 里的每一个变量，包括 ANTHROPIC_API_KEY、GITHUB_TOKEN、AWS_* 这一类。两条路：
 *
 *   - 模型的 bash 工具：在这个基础上换掉五个 PI_* 会话变量（core/tools/bash.ts:177-191），
 *     然后交给可选的 spawnHook（:195）。改法是覆盖 bash 工具，传一个过滤 env 的 spawnHook。
 *   - 用户的 `!`：执行器调 exec 时不传 env（core/bash-executor.ts:108-111），
 *     本地实现就退回 getShellEnv()（core/tools/bash.ts:102），没有钩子可挂。
 *     改法是在 user_bash 里返回一个包过的 operations。
 *
 * 用白名单，不用黑名单：`DATABASE_URL=postgres://u:pw@host/db` 这种名字里不带 KEY、TOKEN 的，
 * 黑名单放得过去。黑名单在这里只做第二道：名字在白名单里、却长得像凭据的，照样拿掉。
 *
 * 所有返回值只带变量名，不带值。
 */

export type Env = Readonly<Record<string, string | undefined>>;

export interface EnvPolicy {
	/** 原样放行的变量名 */
	readonly allow: readonly string[];
	/** 按前缀放行（LC_ALL、LC_CTYPE、PI_SESSION_ID……） */
	readonly allowPrefixes: readonly string[];
	/** 名字像凭据的，即使在白名单里也拿掉 */
	readonly deny: RegExp;
}

export const DEFAULT_ENV_POLICY: EnvPolicy = {
	allow: ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "LANG", "TMPDIR", "TZ", "PWD", "EDITOR", "NO_COLOR", "FORCE_COLOR", "CI"],
	// PI_ 放行，是为了留住 pi 自己设的会话变量（PI_SESSION_ID 等，bash.ts:183-191）；名字像凭据的照样被 deny 拿掉。
	allowPrefixes: ["LC_", "PI_"],
	// AUTH 会顺带拿掉 SSH_AUTH_SOCK：模型的命令用不了 ssh-agent，git push 走 ssh 会失败。
	// 这是故意的——要不要把「推代码」交给模型，是另一个决定，不该被一个环境变量顺手做掉。
	deny: /(KEY|TOKEN|SECRET|PASS(WORD|WD)?|CREDENTIAL|AUTH|COOKIE)/i,
};

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 项目要额外放行的变量（JAVA_HOME、GOPATH……）。名字不合法就拒绝，不悄悄跳过。 */
export function withExtraAllow(policy: EnvPolicy, names: readonly string[]): EnvPolicy {
	const bad = names.filter((name) => !ENV_NAME.test(name));
	if (bad.length > 0) throw new TypeError(`不是合法的环境变量名：${bad.join(", ")}`);
	return { ...policy, allow: [...new Set([...policy.allow, ...names])] };
}

export const keeps = (policy: EnvPolicy, name: string): boolean =>
	(policy.allow.includes(name) || policy.allowPrefixes.some((prefix) => name.startsWith(prefix))) && !policy.deny.test(name);

export interface FilterResult {
	readonly env: Readonly<Record<string, string>>;
	readonly kept: readonly string[];
	readonly dropped: readonly string[];
}

export function filterEnv(env: Env, policy: EnvPolicy = DEFAULT_ENV_POLICY): FilterResult {
	const names = Object.keys(env)
		.filter((name) => env[name] !== undefined)
		.sort();
	const kept = names.filter((name) => keeps(policy, name));
	const dropped = names.filter((name) => !keeps(policy, name));
	const filtered = Object.fromEntries(kept.map((name) => [name, env[name] as string]));
	return { env: filtered, kept, dropped };
}

/** 只用黑名单的话，哪些变量会被留下。用来对照白名单多拦了什么。 */
export const denylistOnlyKeeps = (env: Env, deny: RegExp = DEFAULT_ENV_POLICY.deny): readonly string[] =>
	Object.keys(env)
		.filter((name) => env[name] !== undefined && !deny.test(name))
		.sort();

// ── 接到 pi 的两条路上 ─────────────────────────────────────────────────

/** core/tools/bash.ts:162-168 的 BashSpawnContext */
export interface SpawnContext {
	readonly command: string;
	readonly cwd: string;
	readonly env: Env;
}

/** bash 工具那条路：spawnHook 收到的是 pi 拼好的 env（PATH 已加上 pi 的 bin 目录），按白名单滤一遍。 */
export const envSpawnHook =
	(policy: EnvPolicy = DEFAULT_ENV_POLICY) =>
	(context: SpawnContext): SpawnContext => ({ ...context, env: filterEnv(context.env, policy).env });

/** core/tools/bash.ts:64-81 的 BashOperations，只取用得到的字段 */
export interface ExecOptions {
	readonly onData: (data: Buffer) => void;
	readonly signal?: AbortSignal;
	readonly timeout?: number;
	readonly env?: Env;
}
export interface Operations {
	exec(command: string, cwd: string, options: ExecOptions): Promise<{ exitCode: number | null }>;
}

/**
 * 照 pi 的 getShellEnv（utils/shell.ts:138-150）把 bin 目录加到 PATH 前面。
 * getShellEnv 没有导出，不补这一步，`!` 里就找不到 pi 装在 ~/.pi/agent/bin 下的工具。
 */
export function withBinDir(env: Env, binDir: string, delimiter = ":"): Env {
	const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const current = env[pathKey] ?? "";
	if (current.split(delimiter).includes(binDir)) return env;
	return { ...env, [pathKey]: [binDir, current].filter(Boolean).join(delimiter) };
}

/** `!` 那条路：执行器不给 env，这里补上过滤后的。baseEnv 由调用方给，见 withBinDir。 */
export function wrapOperations(inner: Operations, baseEnv: () => Env, policy: EnvPolicy = DEFAULT_ENV_POLICY): Operations {
	return {
		exec: (command, cwd, options) => inner.exec(command, cwd, { ...options, env: filterEnv(options.env ?? baseEnv(), policy).env }),
	};
}
