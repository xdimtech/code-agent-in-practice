/**
 * 校验配置。配置是用户给的 JSON，是外部输入：每个错误都带出错位置，一次报全。
 *
 * 除了形状，还查两件只有放在一起才看得出的事：mayImport 里的名字都存在，依赖图没有环。
 * 有环的「分层」不是分层——闸门照样能跑，但它守的规则自相矛盾。
 */

import type { GateConfig, Layer } from "./types.ts";

export type ParseResult = { readonly ok: true; readonly config: GateConfig } | { readonly ok: false; readonly errors: readonly string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function stringArray(value: unknown, where: string, errors: string[], nonEmpty = false): string[] {
	if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.length === 0)) {
		errors.push(`${where}：要是非空字符串的数组`);
		return [];
	}
	if (nonEmpty && value.length === 0) errors.push(`${where}：至少要有一项`);
	return value as string[];
}

function parseLayer(raw: unknown, where: string, errors: string[]): Layer | undefined {
	if (!isObject(raw)) {
		errors.push(`${where}：要是对象`);
		return undefined;
	}
	if (typeof raw.name !== "string" || !/^[\w-]+$/.test(raw.name)) errors.push(`${where}.name：只能是字母、数字、_ 和 -`);
	const paths = stringArray(raw.paths, `${where}.paths`, errors, true);
	for (const [i, p] of paths.entries()) {
		if (!p.endsWith("/") || p.startsWith("/") || p.split("/").includes("..")) {
			errors.push(`${where}.paths[${i}]：要是以 / 结尾的仓库相对目录，不能含 ..（拿到的是 ${JSON.stringify(p)}）`);
		}
	}
	return {
		name: String(raw.name),
		paths,
		packages: stringArray(raw.packages ?? [], `${where}.packages`, errors),
		mayImport: stringArray(raw.mayImport ?? [], `${where}.mayImport`, errors),
	};
}

/** 返回一个环（首尾相同的层名序列），没有环时返回 undefined */
export function findCycle(layers: readonly Layer[]): string[] | undefined {
	const edges = new Map(layers.map((l) => [l.name, l.mayImport]));
	const done = new Set<string>();
	const visit = (name: string, stack: readonly string[]): string[] | undefined => {
		const at = stack.indexOf(name);
		if (at >= 0) return [...stack.slice(at), name];
		if (done.has(name)) return undefined;
		for (const next of edges.get(name) ?? []) {
			const cycle = visit(next, [...stack, name]);
			if (cycle) return cycle;
		}
		done.add(name);
		return undefined;
	};
	for (const layer of layers) {
		const cycle = visit(layer.name, []);
		if (cycle) return cycle;
	}
	return undefined;
}

function checkReferences(layers: readonly Layer[], errors: string[]): void {
	const names = new Set<string>();
	for (const [i, layer] of layers.entries()) {
		if (names.has(layer.name)) errors.push(`layers[${i}].name：「${layer.name}」重复了`);
		names.add(layer.name);
	}
	for (const [i, layer] of layers.entries()) {
		for (const target of layer.mayImport) {
			if (target === layer.name) errors.push(`layers[${i}].mayImport：不用写自己，同层导入总是允许`);
			else if (!names.has(target)) errors.push(`layers[${i}].mayImport：没有叫「${target}」的层`);
		}
	}
}

export function parseConfig(raw: unknown): ParseResult {
	const errors: string[] = [];
	if (!isObject(raw)) return { ok: false, errors: ["配置：要是一个 JSON 对象"] };
	if (!Array.isArray(raw.layers) || raw.layers.length === 0) return { ok: false, errors: ["layers：至少要有一层"] };
	const layers = raw.layers.map((l, i) => parseLayer(l, `layers[${i}]`, errors)).filter((l): l is Layer => l !== undefined);
	const internalScopes = stringArray(raw.internalScopes ?? [], "internalScopes", errors);
	const ignore = stringArray(raw.ignore ?? [], "ignore", errors);
	if (errors.length > 0) return { ok: false, errors };
	checkReferences(layers, errors);
	if (errors.length > 0) return { ok: false, errors };
	const cycle = findCycle(layers);
	if (cycle) return { ok: false, errors: [`mayImport 成环：${cycle.join(" → ")}`] };
	return { ok: true, config: { layers, internalScopes, ignore } };
}
