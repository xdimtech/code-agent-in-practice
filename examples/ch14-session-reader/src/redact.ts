// 把会话文件交给别人排障之前先过一遍。pi 记下的工具参数是原样的（core/session-manager.ts:1022、:1034、:1041
// 直接 JSON.stringify，没有 replacer），用户贴进对话、写进命令行的密钥都在里面；图片按 base64 内联
// （packages/ai/src/types.ts:366-370），一张截图就是几百 KB。
// 规则是启发式的：能挡住常见格式，挡不住所有东西，发出去之前还是要人看一遍。

import type { Entry } from "./types.ts";

export const REDACTED = "[已脱敏]";

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE[ ]KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE[ ]KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
];

/** NAME=value 形式，变量名里带 KEY / TOKEN / SECRET / PASSWORD 的，值一律遮掉 */
const ENV_ASSIGNMENT = /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s"']+)/g;

export interface RedactStats {
  readonly secrets: number;
  readonly images: number;
  readonly imageBytes: number;
}

const NONE: RedactStats = { secrets: 0, images: 0, imageBytes: 0 };
const plus = (a: RedactStats, b: RedactStats): RedactStats => ({
  secrets: a.secrets + b.secrets,
  images: a.images + b.images,
  imageBytes: a.imageBytes + b.imageBytes,
});

export function redactString(s: string): { value: string; secrets: number } {
  let secrets = 0;
  let value = s.replace(ENV_ASSIGNMENT, (_m, name: string) => {
    secrets++;
    return `${name}=${REDACTED}`;
  });
  for (const pattern of SECRET_PATTERNS) {
    value = value.replace(pattern, () => {
      secrets++;
      return REDACTED;
    });
  }
  return { value, secrets };
}

const isImagePart = (v: Record<string, unknown>) => v.type === "image" && typeof v.data === "string";

function redactValue(v: unknown): { value: unknown; stats: RedactStats } {
  if (typeof v === "string") {
    const { value, secrets } = redactString(v);
    return { value, stats: { ...NONE, secrets } };
  }
  if (Array.isArray(v)) {
    const parts = v.map(redactValue);
    return { value: parts.map((p) => p.value), stats: parts.reduce((s, p) => plus(s, p.stats), NONE) };
  }
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>;
    if (isImagePart(obj)) {
      const bytes = (obj.data as string).length;
      return { value: { ...obj, data: `[图片已移除：${bytes} 字节 base64]` }, stats: { secrets: 0, images: 1, imageBytes: bytes } };
    }
    const fields = Object.entries(obj).map(([k, x]) => [k, redactValue(x)] as const);
    return {
      value: Object.fromEntries(fields.map(([k, r]) => [k, r.value])),
      stats: fields.reduce((s, [, r]) => plus(s, r.stats), NONE),
    };
  }
  return { value: v, stats: NONE };
}

/** 任意 JSON 值的脱敏；录制 provider 请求时用的也是这一套规则 */
export const redactJson = (v: unknown): { value: unknown; stats: RedactStats } => redactValue(v);

/** 返回新的条目数组，不改原数组；id、parentId 不受影响，树结构保持不变 */
export function redactEntries(entries: readonly Entry[]): { entries: Entry[]; stats: RedactStats } {
  const results = entries.map((e) => redactValue(e));
  return {
    entries: results.map((r) => r.value as Entry),
    stats: results.reduce((s, r) => plus(s, r.stats), NONE),
  };
}
