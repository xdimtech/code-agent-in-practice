/**
 * 脚本 provider 的接线：注册什么模型、每轮流里推什么。
 *
 * 这个文件不 import pi —— 流由调用方给进来（第二个参数）。
 * 原因是静态 import 一定会被执行：只要这里写了 `import ... from "pi-ai"`，
 * extension/*.test.ts 就得先装依赖才能跑。把流做成参数，测试就能用假流。
 * 真流的注入在 extension/scripted-provider.ts。
 */
import { createAssistantDraft, eventsForTurn } from "../src/stream.ts";
import type { ScriptSettings } from "../src/settings.ts";
import type { Context } from "../src/types.ts";

/** 脚本模型的账目：不花钱，但字段要和真的一样，pi 会照常记账。 */
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/**
 * registerProvider 的第二种形态（core/extensions/types.ts:1507 的 ProviderConfig）：
 * 给一个 streamSimple，pi 就不走内置的 HTTP 客户端。
 *
 * 契约要求实现在发请求前调 options.onPayload、收到响应后调 options.onResponse
 * （types.ts:1516-1521）。我们没有"请求"这一步，所以两个都不调 —— 这是本扩展
 * 与真实 provider 最明显的差别，真 provider 必须调。
 */
export interface StreamFactory {
	(): {
		push(event: unknown): void;
		end(): void;
	};
}

/**
 * 流由调用方注入：真流来自 pi-ai（extension/scripted-provider.ts 里传），
 * 测试传假流。wiring.ts 因此不需要装任何依赖。
 *
 * settings 是一个函数而不是一个对象：注册 provider 发生在扩展加载期间，
 * 那时命令行的旗标值还没到手，抄下来的话永远是默认值。
 */
export function createScriptedProvider(settings: () => ScriptSettings, createStream: StreamFactory) {
	return {
		name: "Scripted（离线，不联网）",
		baseUrl: "http://127.0.0.1:0",
		// 定义一个 model 就必须给 apiKey（types.ts:1512）。这里给的是占位符，
		// 它永远不会被发出去：下面的 streamSimple 不建任何连接。
		apiKey: "scripted-no-key-needed",
		api: "scripted",
		models: [
			{
				id: "hello",
				name: "Hello（脚本模型）",
				reasoning: false,
				input: ["text"] as const,
				cost: ZERO_COST,
				contextWindow: 200_000,
				maxTokens: 4096,
			},
		],
		streamSimple(model: { id: string; api: string; provider: string }, context: Context) {
			const stream = createStream();
			// 每一轮一份新草稿。这条 streamSimple 会被调用多次（一次一个回合），
			// content 数组必须每轮重置，否则第二轮的内容块会接在第一轮后面，
			// 而且 modes/json-event.ts:23 读 contentIndex 时会读到别的块。
			const draft = createAssistantDraft(model);

			// 不在 streamSimple 里同步推事件：pi 拿到流之后才订阅，同步推会丢事件。
			// queueMicrotask 把推流排到当前调用栈之后。
			queueMicrotask(() => {
				try {
					// 第一次跑到这里才读旗标：注册 provider 的时候读太早，命令行值还没写进
					// runtime.flagValues（原因见 src/settings.ts 的文件头）。settings() 自带缓存。
					// 放在 try 里面：读旗标本身也可能抛错，那时要变成一条 error 事件，
					// 而不是把异常抛回宿主。
					const { file, tool, report } = settings();
					for (const event of eventsForTurn(draft, context, { file, tool, report })) {
						stream.push(event as never);
					}
				} catch (error) {
					// 出错也要 end()，否则宿主会一直等这个流。
					stream.push({
						type: "error",
						error: error instanceof Error ? error : new Error(String(error)),
					} as never);
				} finally {
					stream.end();
				}
			});

			return stream;
		},
	};
}
