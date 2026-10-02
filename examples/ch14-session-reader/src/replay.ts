// 回放：按顺序把新的请求体和磁带上的比，一样就交出当时录下的回答，不一样就停在第一处差异。
// 用处有两个：不连网络重跑一段对话；改了提示词或工具之后，看从第几个请求开始和以前不一样。
// 接进 pi 的办法是把 hit.message 喂给 faux provider（packages/ai/src/providers/faux.ts:76-99，
// 响应可以是按请求算出来的函数，:107-114）；本例只做比对这一半，不依赖 pi。

import { canonical, fingerprint } from "./recorder.ts";
import { redactJson } from "./redact.ts";
import type { Exchange } from "./tape.ts";

export type ReplayResult =
  | { readonly kind: "hit"; readonly seq: number; readonly message: unknown }
  | { readonly kind: "diverged"; readonly seq: number; readonly path: string; readonly recorded: string; readonly incoming: string }
  | { readonly kind: "no-answer"; readonly seq: number }
  | { readonly kind: "exhausted"; readonly asked: number; readonly recorded: number };

const PREVIEW = 48;
const show = (v: unknown) => {
  const s = v === undefined ? "（没有）" : canonical(v);
  return s.length > PREVIEW ? `${s.slice(0, PREVIEW)}…` : s;
};
/** 两个字符串只在后半截不同时，从分岔处往前一点开始显示，否则截断后两边看起来一样 */
function showPair(a: unknown, b: unknown): [string, string] {
  if (typeof a !== "string" || typeof b !== "string") return [show(a), show(b)];
  const limit = Math.min(a.length, b.length);
  let same = 0;
  while (same < limit && a[same] === b[same]) same++;
  const from = Math.max(0, same - 16);
  const cut = (s: string) => `${from > 0 ? "…" : ""}${s.slice(from, from + PREVIEW)}${s.length > from + PREVIEW ? "…" : ""}`;
  return [cut(a), cut(b)];
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 第一处不同的位置，JSONPath 风格；完全相同返回 undefined */
export function firstDiff(a: unknown, b: unknown, path = "$"): { path: string; a: unknown; b: unknown } | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  if (isObject(a) && isObject(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return undefined;
  }
  return canonical(a) === canonical(b) ? undefined : { path, a, b };
}

/** 第 index 个（从 0 起）新请求对上磁带的第 index 条。新请求先过同一套脱敏再比，否则带密钥的请求永远对不上 */
export function replayStep(tape: readonly Exchange[], index: number, payload: unknown): ReplayResult {
  const exchange = tape[index];
  if (!exchange) return { kind: "exhausted", asked: index + 1, recorded: tape.length };
  const { seq } = exchange.request;
  const redacted = redactJson(payload).value;
  if (fingerprint(redacted) !== exchange.request.fingerprint) {
    const d = firstDiff(exchange.request.payload, redacted);
    const [recorded, incoming] = showPair(d?.a, d?.b);
    return { kind: "diverged", seq, path: d?.path ?? "$", recorded, incoming };
  }
  return exchange.message ? { kind: "hit", seq, message: exchange.message.message } : { kind: "no-answer", seq };
}

/** 依次回放，停在第一个没命中的地方 */
export function replayAll(tape: readonly Exchange[], payloads: readonly unknown[]): ReplayResult[] {
  const results: ReplayResult[] = [];
  for (const [i, payload] of payloads.entries()) {
    const r = replayStep(tape, i, payload);
    results.push(r);
    if (r.kind !== "hit") break;
  }
  return results;
}
