/**
 * 指纹：稳定序列化 + HMAC-SHA256。
 *
 * 两个约束：
 *   1. 不存原文。连击计数只需要知道「这次和上次一样不一样」，所以只留指纹。
 *   2. 指纹只在一轮内有意义。密钥每轮新生成，两轮之间、或者从日志里，都对不上。
 *
 * 序列化有预算：超过字节上限、太深、有环、NaN、非普通对象，一律返回 undefined——
 * 调用方把它记成「跳过了一次」，而不是猜一个值。
 */

import { createHmac, randomBytes } from "node:crypto";

export const MAX_FINGERPRINT_BYTES = 16 * 1024;
const MAX_DEPTH = 32;

export function newSecret(): Buffer {
	return randomBytes(32);
}

export function fingerprint(secret: Buffer, value: unknown, maxBytes = MAX_FINGERPRINT_BYTES): string | undefined {
	const text = stableStringify(value, maxBytes);
	return text === undefined ? undefined : createHmac("sha256", secret).update(text).digest("base64url");
}

/** 键排序后的 JSON；超预算或遇到不可序列化的值返回 undefined */
export function stableStringify(value: unknown, maxBytes = MAX_FINGERPRINT_BYTES): string | undefined {
	const parts: string[] = [];
	let bytes = 0;
	const append = (part: string): boolean => {
		bytes += Buffer.byteLength(part);
		if (bytes > maxBytes) return false;
		parts.push(part);
		return true;
	};
	return write(value, append, new Set(), 0) ? parts.join("") : undefined;
}

function write(value: unknown, append: (part: string) => boolean, seen: Set<object>, depth: number): boolean {
	if (depth > MAX_DEPTH) return false;
	if (value === null || typeof value === "boolean" || typeof value === "string") return append(JSON.stringify(value));
	if (typeof value === "number") return Number.isFinite(value) && append(JSON.stringify(value));
	if (typeof value !== "object" || seen.has(value)) return false;
	if (!Array.isArray(value)) {
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) return false;
	}
	seen.add(value);
	const ok = Array.isArray(value) ? writeArray(value, append, seen, depth) : writeRecord(value as Record<string, unknown>, append, seen, depth);
	seen.delete(value);
	return ok;
}

function writeArray(value: readonly unknown[], append: (part: string) => boolean, seen: Set<object>, depth: number): boolean {
	if (!append("[")) return false;
	for (let i = 0; i < value.length; i++) {
		if (i > 0 && !append(",")) return false;
		if (!write(value[i], append, seen, depth + 1)) return false;
	}
	return append("]");
}

function writeRecord(value: Record<string, unknown>, append: (part: string) => boolean, seen: Set<object>, depth: number): boolean {
	const keys = Object.keys(value).sort();
	if (!append("{")) return false;
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]!;
		if (i > 0 && !append(",")) return false;
		if (!append(`${JSON.stringify(key)}:`) || !write(value[key], append, seen, depth + 1)) return false;
	}
	return append("}");
}
