// 规范 JSON：键按字典序、没有空白、拒绝 JSON 表示不了的值。
// 哈希算的是字节，同一份内容必须只有一种写法；否则写入时和校验时序列化得不一样，好好的记录也对不上。

import type { Json } from "./types.ts";

export class CanonicalError extends Error {}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function object(value: Record<string, unknown>, path: string): string {
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined) // 和 JSON.stringify 一致：值为 undefined 的键当作不存在
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k], `${path}.${k}`)}`).join(",")}}`;
}

export function canonicalJson(value: unknown, path = "$"): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalError(`${path} 不是有限数：${value}`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) return `[${value.map((v, i) => canonicalJson(v, `${path}[${i}]`)).join(",")}]`;
      if (!isPlainObject(value)) throw new CanonicalError(`${path} 不是普通对象（${value.constructor?.name ?? "?"}）`);
      return object(value, path);
    default:
      throw new CanonicalError(`${path} 是 ${typeof value}，JSON 表示不了`);
  }
}

/** 深拷贝成纯 JSON 值，顺便校验；记录里的 body 都从这里来，不和调用方共享对象 */
export const toJson = (value: unknown): Json => JSON.parse(canonicalJson(value)) as Json;
