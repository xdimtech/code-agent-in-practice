/**
 * 强烈建议的一件：没人接的 Promise 拒绝，也要走 pi 自己的崩溃收尾。
 *
 * pi 交互模式只挂了 uncaughtException（modes/interactive/interactive-mode.ts:4058-4064），
 * 收尾函数 uncaughtCrash（:4000）会先把终端从 raw 模式恢复过来再退出。
 * 没挂 unhandledRejection。这在 Node 的默认模式下不是问题——没有 unhandledRejection 监听器时，
 * Node 把拒绝升级成 uncaughtException。但有两种情况升级不会发生：
 *
 *   - 用 `bun build --compile` 出的单文件二进制（package.json 的 build:binary）。
 *     【实机】Bun 1.3.14 下只挂 uncaughtException，拒绝直接打印 "error: boom" 退出，处理器没被调用。
 *   - Node 下，进程里任何一个库自己挂了 unhandledRejection 又什么都不做：Node 不再升级，拒绝被吞掉。
 *
 * 补法：挂一个 unhandledRejection，把拒绝原因当异常重新抛出。抛出来的东西两边都会交给
 * uncaughtException，也就回到了 pi 的收尾路径上。【实机】Node v22 与 Bun 1.3.14 都验证过。
 */

/** 拒绝原因可以是任何值；先转成 Error，消息里不展开对象内容。 */
export function toError(reason: unknown): Error {
	if (reason instanceof Error) return reason;
	if (typeof reason === "string") return new Error(reason);
	if (reason === undefined || reason === null) return new Error(`Promise 被拒绝，原因是 ${String(reason)}`);
	const kind = typeof reason === "object" ? (Object.getPrototypeOf(reason)?.constructor?.name ?? "Object") : typeof reason;
	return new Error(`Promise 被拒绝，原因是一个 ${kind}（不是 Error）`);
}

export interface RejectionTarget {
	on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
	off(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

/** 返回撤销函数。处理器本身只做一件事：抛出。 */
export function installRejectionFallback(target: RejectionTarget): () => void {
	const listener = (reason: unknown): void => {
		throw toError(reason);
	};
	target.on("unhandledRejection", listener);
	return () => {
		target.off("unhandledRejection", listener);
	};
}

export type Runtime = "node" | "bun";

export const runtimeOf = (versions: Readonly<Record<string, string | undefined>>): Runtime => (versions.bun ? "bun" : "node");

/** probe.ts 的四个场景。每个场景先模拟 pi：只挂一个 uncaughtException。 */
export const SCENARIOS = ["pi-only", "swallowed", "fallback", "swallowed+fallback"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const isScenario = (value: string | undefined): value is Scenario => SCENARIOS.includes(value as Scenario);
