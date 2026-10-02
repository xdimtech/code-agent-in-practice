// vendor 标记：把上游源码整份拷进自己仓库时，旁边放一个 JSON，写清楚拷的是哪个 commit、台账在哪。
// 升级脚本从这里知道「基线」是谁；它要是错了或者指向不存在的文件，后面的三方分诊就没有地基。

import type { Finding } from "./types.ts";

export interface VendorMarker {
  readonly name: string;
  readonly upstreamUrl: string;
  readonly ref?: string;
  readonly commit: string;
  readonly importedAt: string;
  /** 标记里引用的其他文件：字段名 → 相对路径 */
  readonly references: ReadonlyMap<string, string>;
}

export interface VendorCheck {
  readonly marker?: VendorMarker;
  readonly findings: readonly Finding[];
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const REFERENCE_KEYS = ["localChangeLog", "policy"] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const err = (rule: string, message: string): Finding => ({ severity: "error", rule, message });

/**
 * exists 判断一个相对标记文件所在目录的路径存不存在——由调用方注入，这里不碰磁盘。
 */
export function checkVendorMarker(json: string, exists: (relative: string) => boolean): VendorCheck {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    return { findings: [err("bad-json", `不是合法 JSON：${(error as Error).message}`)] };
  }
  if (!isObject(data)) return { findings: [err("bad-json", "顶层应该是对象")] };
  const upstream = isObject(data.upstream) ? data.upstream : {};
  const commit = text(upstream.commit);
  const url = text(upstream.url);
  const importedAt = text(data.importedAt);
  const references = new Map(REFERENCE_KEYS.flatMap((k) => (text(data[k]) ? [[k, text(data[k])] as const] : [])));
  const findings: Finding[] = [
    ...(FULL_SHA.test(commit) ? [] : [err("commit-not-pinned", `upstream.commit 应该是 40 位 commit，现在是「${commit || "空"}」——tag 和分支会动，commit 不会`)]),
    ...(url.startsWith("https://") ? [] : [err("bad-url", `upstream.url 应该是 https 地址，现在是「${url || "空"}」`)]),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(importedAt) ? [] : [err("bad-date", `importedAt 应该是 YYYY-MM-DD，现在是「${importedAt || "空"}」`)]),
    ...(references.has("localChangeLog") ? [] : [err("no-ledger", "没写 localChangeLog：改了上游哪些地方无处可查")]),
    ...[...references].filter(([, path]) => !exists(path)).map(([key, path]) => err("dangling-reference", `${key} 指向 ${path}，这个文件不存在`)),
  ];
  const marker: VendorMarker = {
    name: text(data.name),
    upstreamUrl: url,
    ...(text(upstream.ref) ? { ref: text(upstream.ref) } : {}),
    commit,
    importedAt,
    references,
  };
  return { marker, findings };
}

/** 导入距今多少天。日期认不出来返回 undefined */
export function ageInDays(importedAt: string, today: Date): number | undefined {
  const t = Date.parse(`${importedAt}T00:00:00Z`);
  if (Number.isNaN(t)) return undefined;
  return Math.floor((today.getTime() - t) / 86_400_000);
}
