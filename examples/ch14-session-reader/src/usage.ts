// 花了多少钱。三件事要分清：
// 1. 每条助手消息的 usage.cost 是收到回复那一刻按当时的价格表算好、写死在消息里的（packages/ai/src/models.ts:878-898）；
// 2. /session 和底栏把文件里「所有」条目都加起来（core/agent-session.ts:3318-3353），被放弃的分支、被压缩掉的历史都算钱；
// 3. 按模型拆分时用 responseModel 优先（core/usage-totals.ts:44），路由到哪个模型就记在哪个模型名下。

import { isAssistant, isToolResult, type Cost, type Entry, type Usage } from "./types.ts";

export interface Totals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cost: number;
}

export const ZERO: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

export const addUsage = (t: Totals, u: Usage): Totals => ({
  input: t.input + u.input,
  output: t.output + u.output,
  cacheRead: t.cacheRead + u.cacheRead,
  cacheWrite: t.cacheWrite + u.cacheWrite,
  cost: t.cost + u.cost.total,
});

/** 一个条目带来的计费用量及其归属；和 getUsageCostBreakdown 的三种来源一致（core/usage-totals.ts:40-52） */
export function billedUsage(e: Entry): { key: string; usage: Usage } | undefined {
  const m = e.message;
  if (e.type === "message" && isAssistant(m)) return { key: `${m.provider}/${m.responseModel ?? m.model}`, usage: m.usage };
  if (e.type === "message" && isToolResult(m) && m.usage) return { key: "Tools/summaries", usage: m.usage };
  if ((e.type === "compaction" || e.type === "branch_summary") && e.usage) return { key: "Tools/summaries", usage: e.usage };
  return undefined;
}

export function sumEntries(entries: readonly Entry[]): Totals {
  return entries.reduce((t, e) => {
    const billed = billedUsage(e);
    return billed ? addUsage(t, billed.usage) : t;
  }, ZERO);
}

export function breakdown(entries: readonly Entry[]): { key: string; totals: Totals }[] {
  const byKey = new Map<string, Totals>();
  for (const e of entries) {
    const billed = billedUsage(e);
    if (billed) byKey.set(billed.key, addUsage(byKey.get(billed.key) ?? ZERO, billed.usage));
  }
  return [...byKey].map(([key, totals]) => ({ key, totals })).sort((a, b) => b.totals.cost - a.totals.cost);
}

/** 每百万 token 的美元价格（packages/ai/src/types.ts:803-808） */
export interface BaseRates {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** 长上下文阶梯：输入超过阈值时整次请求换一套价格，取命中的最高阈值（:810-818） */
export interface Rates extends BaseRates {
  readonly tiers?: readonly (BaseRates & { readonly inputTokensAbove: number })[];
}

/** 与 calculateCost 同一个公式，但返回新对象，不改传进来的 usage（pi 的版本是就地改写 :892-896） */
export function calculateCost(rates: Rates, u: Usage): Cost {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const hit = (rates.tiers ?? []).filter((t) => prompt > t.inputTokensAbove);
  const r: BaseRates = hit.reduce<BaseRates & { inputTokensAbove: number } | undefined>(
    (best, t) => (best && best.inputTokensAbove >= t.inputTokensAbove ? best : t),
    undefined,
  ) ?? rates;
  const longWrite = u.cacheWrite1h ?? 0; // Anthropic 的 1 小时缓存写按 2 倍输入价计（:889-895）
  const cost = {
    input: (r.input / 1e6) * u.input,
    output: (r.output / 1e6) * u.output,
    cacheRead: (r.cacheRead / 1e6) * u.cacheRead,
    cacheWrite: (r.cacheWrite * (u.cacheWrite - longWrite) + r.input * 2 * longWrite) / 1e6,
  };
  return { ...cost, total: cost.input + cost.output + cost.cacheRead + cost.cacheWrite };
}

export const usd = (n: number) => `$${n.toFixed(4)}`;
