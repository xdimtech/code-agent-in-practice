// 参数校验，照 pi 的 validateToolArguments（ai/src/utils/validation.ts:317-350）走同样四步：
//   1. 复制一份，不动模型给的原值（:318）
//   2. 可选字段上的 null 直接删掉（normalizeOptionalNulls，:240-269）
//   3. 按 schema 把标量转成该有的类型（coercePrimitiveByType，:59-131；本例的 schema 不是 TypeBox，走 :323-335 这条路）
//   4. 检查；不通过就抛错，消息格式照 :341-349
// 错误措辞是本例自己写的，pi 用的是 TypeBox 的措辞；路径格式（a.b.0、required 时拼上字段名、空路径写 root）照 :282-293。

import type { Schema } from "./types.ts";

export interface Issue {
  readonly path: string;
  readonly message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 可选字段是 null 就删掉：模型常把「不填」写成 null。必填字段的 null 留给下一步 */
export function dropOptionalNulls(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value)) return schema.items ? value.map((v) => dropOptionalNulls(v, schema.items as Schema)) : value;
  if (!isRecord(value) || !schema.properties) return value;
  const required = new Set(schema.required ?? []);
  const props = schema.properties;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k, v]) => !(v === null && k in props && !required.has(k)))
      .map(([k, v]) => [k, k in props ? dropOptionalNulls(v, props[k]) : v]),
  );
}

/** 标量转换，规则照 validation.ts:59-131：数字串转数字、true/false 串转布尔、null 转零值 */
function coerceScalar(value: unknown, type: Schema["type"]): unknown {
  const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  switch (type) {
    case "number":
      if (value === null) return 0;
      if (Number.isFinite(numeric)) return numeric;
      return typeof value === "boolean" ? Number(value) : value;
    case "integer":
      if (value === null) return 0;
      if (Number.isInteger(numeric)) return numeric;
      return typeof value === "boolean" ? Number(value) : value;
    case "boolean":
      if (value === null || value === "false" || value === 0) return false;
      return value === "true" || value === 1 ? true : value;
    case "string":
      if (value === null) return "";
      return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
    default:
      return value;
  }
}

export function coerce(value: unknown, schema: Schema): unknown {
  if (schema.type === "object" && isRecord(value)) {
    const props = schema.properties ?? {};
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k in props ? coerce(v, props[k]) : v]));
  }
  if (schema.type === "array" && Array.isArray(value)) return schema.items ? value.map((v) => coerce(v, schema.items as Schema)) : value;
  return coerceScalar(value, schema.type);
}

const join = (base: string, key: string | number): string => (base === "" ? String(key) : `${base}.${key}`);

function typeMatches(value: unknown, type: Schema["type"]): boolean {
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function checkObject(value: Record<string, unknown>, schema: Schema, path: string): Issue[] {
  const props = schema.properties ?? {};
  const missing = (schema.required ?? []).filter((k) => !(k in value)).map((k) => ({ path: join(path, k), message: "is required" }));
  const extra =
    schema.additionalProperties === false
      ? Object.keys(value).filter((k) => !(k in props)).map((k) => ({ path: join(path, k), message: "is not allowed (additionalProperties: false)" }))
      : [];
  const nested = Object.entries(props).flatMap(([k, s]) => (k in value ? check(value[k], s, join(path, k)) : []));
  return [...missing, ...extra, ...nested];
}

export function check(value: unknown, schema: Schema, path = ""): Issue[] {
  if (!typeMatches(value, schema.type)) return [{ path, message: `must be ${schema.type}` }];
  if (schema.type === "object") return checkObject(value as Record<string, unknown>, schema, path);
  if (schema.type === "array") return schema.items ? (value as unknown[]).flatMap((v, i) => check(v, schema.items as Schema, join(path, i))) : [];
  if (schema.enum && !schema.enum.includes(value as string)) return [{ path, message: `must be one of ${schema.enum.join(", ")}` }];
  if (schema.minimum !== undefined && (value as number) < schema.minimum) return [{ path, message: `must be >= ${schema.minimum}` }];
  if (schema.maximum !== undefined && (value as number) > schema.maximum) return [{ path, message: `must be <= ${schema.maximum}` }];
  return [];
}

/** 校验通过返回转换后的新参数；不通过抛错，错误消息会原样成为工具结果交给模型 */
export function validateArguments(toolName: string, schema: Schema, raw: unknown): unknown {
  const args = coerce(dropOptionalNulls(structuredClone(raw), schema), schema);
  const issues = check(args, schema);
  if (issues.length === 0) return args;
  const lines = issues.map((i) => `  - ${i.path || "root"}: ${i.message}`).join("\n");
  throw new Error(`Validation failed for tool "${toolName}":\n${lines}\n\nReceived arguments:\n${JSON.stringify(raw, null, 2)}`);
}
