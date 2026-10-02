// 比较两份参数，列出不一样的路径。用来对照「模型提议的参数」和「真正执行的参数」：
// pi 的会话记的是前者（assistant 消息里的 toolCall.arguments），执行的是校验、转换、钩子改过之后的那份。

import { canonicalJson } from "./canonical.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const join = (path: string, key: string | number): string => (typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key);

/** 递归比较；undefined 和缺键视为相同（落进 JSON 后本来就一样） */
export function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => diffPaths(a[k], b[k], join(path, k)));
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((v, i) => diffPaths(v, b[i], join(path, i)));
  }
  if (a === undefined && b === undefined) return [];
  if (a === undefined || b === undefined) return [path || "$"];
  return canonicalJson(a) === canonicalJson(b) ? [] : [path || "$"];
}
