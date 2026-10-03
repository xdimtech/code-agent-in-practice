/**
 * pi 扩展的入口：注入真的流，注册脚本 provider。
 *
 * 这个文件是唯一 import pi 的地方；其余逻辑在 extension/wiring.ts 和 src/ 下，
 * 都不带依赖，所以 `npm test` 不需要装任何东西。
 */
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { lazySettings } from "../src/settings.ts";
import { createScriptedProvider, type StreamFactory } from "./wiring.ts";

export { createScriptedProvider } from "./wiring.ts";
export type { StreamFactory } from "./wiring.ts";

/**
 * pi 加载扩展时调一次这个默认导出。
 *
 * 这里只登记旗标名，不读值 —— 这个函数执行的时候，命令行给的值还没写进
 * runtime.flagValues（顺序见 src/settings.ts 的文件头）。真正读值推迟到第一次
 * 真的要用的时候，由 lazySettings 完成。
 */
export default function scriptedProviderExtension(pi: {
	registerProvider: (name: string, config: unknown) => void;
	registerFlag?: (
		name: string,
		options: { description?: string; type: "boolean" | "string"; default?: boolean | string },
	) => void;
	getFlag?: (name: string) => boolean | string | undefined;
}) {
	pi.registerFlag?.("demo-file", { description: "脚本模型第一轮读的文件", type: "string" });
	pi.registerFlag?.("demo-tool", { description: "脚本模型第一轮调用的工具", type: "string" });
	pi.registerFlag?.("demo-quiet", { description: "只回一行，不摊开上下文", type: "boolean" });
	const settings = lazySettings((name) => pi.getFlag?.(name));
	pi.registerProvider("scripted", createScriptedProvider(settings, createAssistantMessageEventStream as unknown as StreamFactory));
}

