/**
 * 四件必补 + 一件强烈建议，汇成一张表。
 *
 * 输入是「事实」，不是配置：哪些钩子真的挂上了、启动 pi 的环境里有什么、用的是哪个运行时。
 * pi 开箱和装了本例扩展各是一组事实，跑同一个 evaluate，差别一眼能看出来。
 */

import type { Runtime } from "./crash.ts";
import type { ScriptStatus } from "./install-scripts.ts";

export interface Facts {
	readonly loopGuard: { readonly repeatBlock: boolean; readonly turnCeiling: boolean };
	/** isolated：命令是否跑在操作系统级的隔离里（容器、虚拟机，第 17 章） */
	readonly confirm: { readonly toolCall: boolean; readonly userBash: boolean; readonly isolated: boolean };
	readonly credentials: { readonly bashTool: boolean; readonly userBash: boolean };
	readonly installScripts: ScriptStatus;
	readonly crash: { readonly runtime: Runtime; readonly fallback: boolean };
}

export type Status = "ok" | "partial" | "missing";

export interface Item {
	readonly name: string;
	readonly must: boolean;
	readonly status: Status;
	readonly detail: string;
	readonly fix: string;
}

const pair = (a: boolean, b: boolean): Status => (a && b ? "ok" : a || b ? "partial" : "missing");

function loopItem(facts: Facts): Item {
	const { repeatBlock, turnCeiling } = facts.loopGuard;
	return {
		name: "刹车",
		must: true,
		status: pair(repeatBlock, turnCeiling),
		detail: `重复调用拦截 ${repeatBlock ? "有" : "无"}，轮数上限 ${turnCeiling ? "有" : "无"}`,
		fix: "loop-guard.ts：tool_call 返回 terminate，turn_end 到上限 ctx.abort()（第 18 章）",
	};
}

function confirmItem(facts: Facts): Item {
	const { toolCall, userBash, isolated } = facts.confirm;
	const nature = isolated ? "外面有操作系统级隔离" : "没有隔离，确认只是提醒，不是边界（docs/security.md:35）";
	return {
		name: "确认",
		must: true,
		status: pair(toolCall, userBash),
		detail: `模型的工具 ${toolCall ? "有" : "无"}，用户的 ! ${userBash ? "有" : "无"}；${nature}`,
		fix: "第 15 章的 toolCallGate / userBashGate，两条路接同一份策略；要边界看第 17 章",
	};
}

function credentialItem(facts: Facts): Item {
	const { bashTool, userBash } = facts.credentials;
	return {
		name: "凭据",
		must: true,
		status: pair(bashTool, userBash),
		detail: `bash 工具 ${bashTool ? "按白名单" : "全量继承"}，用户的 ! ${userBash ? "按白名单" : "全量继承"}`,
		fix: "env-filter.ts：spawnHook + user_bash 返回包过的 operations（第 21 章）",
	};
}

function installItem(facts: Facts): Item {
	const status = facts.installScripts;
	const fix = '启动前 export npm_config_ignore_scripts=true，或 settings.json 写 "npmCommand": ["npm", "--ignore-scripts"]（第 13 章）';
	switch (status.kind) {
		case "skipped":
			return { name: "安装脚本", must: true, status: "ok", detail: `npm 不跑脚本（来自${status.via === "env" ? "环境变量" : " npmCommand 参数"}）`, fix };
		case "runs":
			return { name: "安装脚本", must: true, status: "missing", detail: "pi install 会跑整棵依赖树的安装脚本", fix };
		case "manager-default":
			return { name: "安装脚本", must: true, status: "partial", detail: `${status.manager} 默认不跑依赖脚本，但包自己的脚本照跑`, fix };
		case "unknown":
			return { name: "安装脚本", must: true, status: "partial", detail: `不认识的包管理器 ${status.manager || "(空)"}，没法判断`, fix };
	}
}

function crashItem(facts: Facts): Item {
	const { runtime, fallback } = facts.crash;
	const status: Status = fallback ? "ok" : runtime === "bun" ? "missing" : "partial";
	const detail = fallback
		? "未接住的拒绝会重新抛出，走 pi 的收尾"
		: runtime === "bun"
			? "Bun 二进制下未接住的拒绝不经过 pi 的收尾，终端可能停在 raw 模式"
			: "Node 默认会把拒绝升级成异常；进程里有库吞掉拒绝时不会";
	return { name: "崩溃收尾", must: false, status, detail, fix: "crash.ts：installRejectionFallback" };
}

export const evaluate = (facts: Facts): readonly Item[] => [loopItem(facts), confirmItem(facts), credentialItem(facts), installItem(facts), crashItem(facts)];

/** 只有「必补」全部 ok 才返回 0。建议项不影响退出码。 */
export const exitCode = (items: readonly Item[]): number => (items.every((item) => !item.must || item.status === "ok") ? 0 : 1);

const MARK: Record<Status, string> = { ok: "✓", partial: "△", missing: "✗" };

export function render(items: readonly Item[]): string {
	return items
		.map((item) => `  ${MARK[item.status]} ${item.must ? "必补" : "建议"}  ${item.name.padEnd(4, "　")}  ${item.detail}${item.status === "ok" ? "" : `\n              → ${item.fix}`}`)
		.join("\n");
}

/** pi b79e4cc8 开箱：什么都没挂。运行时和安装脚本状态由调用方按实际环境给。 */
export const outOfBox = (runtime: Runtime, installScripts: ScriptStatus): Facts => ({
	loopGuard: { repeatBlock: false, turnCeiling: false },
	confirm: { toolCall: false, userBash: false, isolated: false },
	credentials: { bashTool: false, userBash: false },
	installScripts,
	crash: { runtime, fallback: false },
});
