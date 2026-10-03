/**
 * 脚本模型读什么文件、调什么工具，由扩展旗标和（没有旗标时的）环境变量决定。
 *
 * 为什么不把参数塞进 model id：pi 的模型名会进会话文件、会出现在 /model 列表里，
 * 让它带信息会把"模型"和"参数"混成一件事。旗标是给这件事准备的口子
 * （core/extensions/types.ts:1329 的 registerFlag，取值 :1345 的 getFlag）。
 *
 * 什么时候读旗标，是这个文件最容易写错的地方。pi 的启动顺序是：
 *
 *   1. 解析命令行，未知选项收进 parsed.unknownFlags（main.ts:602）；
 *   2. 把 unknownFlags 交给 createAgentSessionServices（main.ts:736）；
 *   3. reload() 加载扩展 —— 工厂函数在这里执行；
 *   4. 加载完，才把 unknownFlags 里的值按名字写进 runtime.flagValues
 *      （core/agent-session-services.ts:183，函数体 :99-118）。
 *
 * 第 3 步 getFlag 拿得到的只有 registerFlag 时登记的默认值（core/extensions/loader.ts:329-331
 * 写 pendingFlagValues），第 4 步的命令行值还没进去。所以在工厂函数里取一次快照，
 * 拿到的永远是默认值，命令行参数会被无声地忽略。
 *
 * 正确做法是延迟到第一次用的时候再读：那时第 4 步已经执行完，
 * runtime.flagValues 里是命令行给的值。lazySettings 就是干这个的。
 */

export interface ScriptSettings {
	/** 第一轮读哪个文件。 */
	readonly file: string;
	/** 第一轮调哪个工具。默认 read；换成 edit 可以让第二轮拿到 isError 的结果。 */
	readonly tool: string;
	/** 第二轮是不是把上下文摊开报出来。 */
	readonly report: boolean;
}

export const DEFAULT_FILE = "hello.txt";
export const DEFAULT_TOOL = "read";

/** 环境变量兜底：扩展旗标在 -p 和 --mode json 下都好用，但 CI 里写环境变量更省事。 */
export const ENV_FILE = "PI_DEMO_FILE";
export const ENV_TOOL = "PI_DEMO_TOOL";

export function resolveSettings(
	flag: (name: string) => boolean | string | undefined,
	env: Record<string, string | undefined> = process.env,
): ScriptSettings {
	// 用 asString 统一收口，不能直接 `?? env[...]`：环境变量被设成空串
	// （`FOO= pi …`）时 `??` 不会跳过它，空串会一路传下去，模型拿到一个空文件名。
	const file = asString(flag("demo-file")) ?? asString(env[ENV_FILE]) ?? DEFAULT_FILE;
	const tool = asString(flag("demo-tool")) ?? asString(env[ENV_TOOL]) ?? DEFAULT_TOOL;
	const report = flag("demo-quiet") === true ? false : true;
	return { file, tool, report };
}

function asString(value: boolean | string | undefined): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * 把"读旗标"这件事延迟到第一次取设置的时候。
 *
 * 工厂函数执行时（加载期间）不能把值抄下来，原因见文件头。这里返回一个函数，
 * 第一次调用才真正解一次，之后把结果留在闭包里 —— 一个进程内旗标不会变，
 * 重复解没有意义。
 */
export function lazySettings(
	flag: (name: string) => boolean | string | undefined,
	env: Record<string, string | undefined> = process.env,
): () => ScriptSettings {
	let cached: ScriptSettings | undefined;
	return () => {
		cached ??= resolveSettings(flag, env);
		return cached;
	};
}
