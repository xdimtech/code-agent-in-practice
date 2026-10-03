/**
 * 一次没人接的 Promise 拒绝，会不会落到「pi 的」uncaughtException 处理器上？
 *
 *   node --experimental-strip-types --no-warnings scripts/probe.ts <场景>
 *   bunx bun@1.3.14 scripts/probe.ts <场景>
 *
 * 输出一行：
 *   caught   处理器拿到了——pi 会走 uncaughtCrash，先恢复终端再退出
 *   alive    谁都没拿到，进程还活着——拒绝被吞了
 *   （没有输出、退出码非 0）运行时自己打印错误退出——终端停在 raw 模式
 */
import { installRejectionFallback, isScenario, SCENARIOS } from "../src/crash.ts";

const scenario = process.argv[2];
if (!isScenario(scenario)) {
	console.error(`用法：probe.ts <${SCENARIOS.join(" | ")}>`);
	process.exit(2);
}

// 模拟 pi：interactive-mode.ts:4062 的 prependListener
process.prependListener("uncaughtException", (error) => {
	console.log(`caught ${error.message}`);
	process.exit(0);
});

// 模拟进程里某个库：挂了 unhandledRejection，什么都不做
if (scenario === "swallowed" || scenario === "swallowed+fallback") process.on("unhandledRejection", () => {});

if (scenario === "fallback" || scenario === "swallowed+fallback") installRejectionFallback(process);

Promise.reject(new Error("boom"));

setTimeout(() => {
	console.log("alive");
	process.exit(0);
}, 200);
