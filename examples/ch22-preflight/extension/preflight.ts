/**
 * pi 扩展入口：把真的 pi 函数注入 wiring。
 *
 *   pi -e ./extension/preflight.ts
 *
 * 这个文件是唯一 import pi 的地方；其余逻辑在 extension/wiring.ts 和 src/ 下，
 * 都不带依赖，所以 `npm test` 不需要装任何东西。
 *
 * 确认用的是第 15 章的两个适配器和它的默认策略（mode: "ask"）。
 * 它们构造时要一个 ui；pi 的 ui 挂在每次调用的 ctx 上，所以每次调用现做一个。
 */
import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition, createLocalBashOperations, getAgentDir } from "@earendil-works/pi-coding-agent";
import { toolCallGate, userBashGate } from "../../ch15-policy-layer/src/hooks.ts";
import { DEFAULT_POLICY } from "../../ch15-policy-layer/src/types.ts";
import { runtimeOf } from "../src/crash.ts";
import { withBinDir } from "../src/env-filter.ts";
import { parseSettings, type PiSettings } from "../src/settings.ts";
import { installPreflight, type Ctx, type PiLike } from "./wiring.ts";

const uiOf = (ctx: Ctx) => (ctx.hasUI ? { confirm: (title: string, detail: string) => ctx.ui.confirm(title, detail) } : undefined);

/**
 * 只读全局设置，读不到算没设；格式错就在加载时报出来，不悄悄当成没设。
 * 不读项目里的 .pi/settings.json：它在 pi 里能覆盖全局（core/settings-manager.ts:333），
 * 但一个仓库不该能替你改掉 shell 或装包命令。代价是项目级的 shellPath 在覆盖后的 bash 上不生效。
 */
function globalSettings(): PiSettings {
	let text: string;
	try {
		text = readFileSync(join(getAgentDir(), "settings.json"), "utf8");
	} catch {
		return {};
	}
	return parseSettings(text);
}

export default function preflight(pi: ExtensionAPI) {
	const cwd = process.cwd();
	const settings = globalSettings();
	installPreflight(pi as unknown as PiLike, {
		cwd,
		shell: { shellPath: settings.shellPath, commandPrefix: settings.shellCommandPrefix },
		createBashToolDefinition: createBashToolDefinition as unknown as Parameters<typeof installPreflight>[1]["createBashToolDefinition"],
		createLocalBashOperations,
		baseEnv: () => withBinDir(process.env, join(getAgentDir(), "bin"), delimiter),
		process,
		runtime: runtimeOf(process.versions),
		installFacts: () => ({ npmCommand: globalSettings().npmCommand, env: process.env }),
		toolCallGate: (event, ctx) => toolCallGate({ policy: DEFAULT_POLICY, cwd, ui: uiOf(ctx) })(event),
		userBashGate: (event, ctx) => userBashGate({ policy: DEFAULT_POLICY, cwd: event.cwd, ui: uiOf(ctx) })(event),
	});
}
