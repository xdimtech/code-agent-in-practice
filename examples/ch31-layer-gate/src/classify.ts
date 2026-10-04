/**
 * 判定：一条 (导入方, 说明符) 允许还是违规。纯函数，不碰文件系统——所以才能自测。
 *
 * 和 Step-Code 的 analyzeImport 一样，整个闸门只有这一个判定函数；不一样的是失败方向：
 * Step-Code 那道闸门对「不在它规则覆盖范围里的文件」返回 null（放行），本例返回违规。
 */

import { posix } from "node:path";

import type { GateConfig, Layer, Target, Violation } from "./types.ts";

/** 文件属于哪一层：取最长的目录前缀匹配，嵌套目录可以分属不同层 */
export function layerOfPath(config: GateConfig, repoPath: string): Layer | undefined {
	let best: { layer: Layer; length: number } | undefined;
	for (const layer of config.layers) {
		for (const prefix of layer.paths) {
			if (repoPath.startsWith(prefix) && (!best || prefix.length > best.length)) best = { layer, length: prefix.length };
		}
	}
	return best?.layer;
}

const matchesPackage = (specifier: string, name: string) => specifier === name || specifier.startsWith(`${name}/`);

/** 说明符指向哪一层；外部包返回 external，认不出的内部目标返回 unassigned */
export function resolveTarget(config: GateConfig, importer: string, specifier: string): Target {
	if (specifier.startsWith(".")) {
		const resolved = posix.normalize(posix.join(posix.dirname(importer), specifier));
		const layer = layerOfPath(config, resolved);
		return layer ? { kind: "layer", layer } : { kind: "unassigned", resolved };
	}
	const layer = config.layers.find((l) => l.packages.some((name) => matchesPackage(specifier, name)));
	if (layer) return { kind: "layer", layer };
	if (config.internalScopes.some((scope) => specifier.startsWith(scope))) return { kind: "unassigned", resolved: specifier };
	return { kind: "external" };
}

export function checkImport(config: GateConfig, importer: string, specifier: string): Violation | undefined {
	const from = layerOfPath(config, importer);
	if (!from) {
		return { kind: "unassigned-importer", importer, specifier, message: `${importer} 不在任何一层里——先给它归层，闸门才知道该用哪条规则` };
	}
	const target = resolveTarget(config, importer, specifier);
	if (target.kind === "external") return undefined;
	if (target.kind === "unassigned") {
		return {
			kind: "unassigned-target",
			importer,
			specifier,
			message: `${from.name} 导入了「${specifier}」${target.resolved === specifier ? "" : `（→ ${target.resolved}）`}，它是内部代码却不属于任何一层`,
		};
	}
	if (target.layer.name === from.name || from.mayImport.includes(target.layer.name)) return undefined;
	return {
		kind: "forbidden-edge",
		importer,
		specifier,
		message: `${from.name} → ${target.layer.name} 不在 ${from.name}.mayImport 里（「${specifier}」）`,
	};
}
