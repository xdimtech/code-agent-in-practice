import { estimateTokens } from "./context-files.ts";
import type { Request } from "./types.ts";

const SEP = "␞";

export interface Serialized {
  readonly text: string;
  /** 打缓存断点的位置（字符偏移），对应 pi 适配器标 cache_control 的三处。 */
  readonly breakpoints: readonly number[];
}

/**
 * 按 Anthropic 的顺序拼：tools → system → messages。
 * 断点：最后一个工具、system、最后一条消息（是 user 的话）——anthropic-messages.ts:1360、:1026-1031、:1295-1316。
 */
export function serialize(request: Request): Serialized {
  const tools = `tools${SEP}${JSON.stringify(request.tools)}${SEP}`;
  const system = `${tools}system${SEP}${request.system}${SEP}`;
  const text = request.messages.reduce((acc, message) => `${acc}${message.role}${SEP}${message.content}${SEP}`, system);
  const last = request.messages.at(-1);
  const breakpoints = [request.tools.length > 0 ? tools.length : 0, system.length, last?.role === "user" ? text.length : 0].filter((n) => n > 0);
  return { text, breakpoints };
}

export interface CacheState {
  /** 已经写进缓存的前缀。真实服务端还有 TTL 和容量，这里不建模。 */
  readonly prefixes: readonly string[];
}

export interface CacheResult {
  readonly inputTokens: number;
  readonly cachedTokens: number;
}

export const EMPTY_CACHE: CacheState = { prefixes: [] };

/**
 * 简化的前缀缓存：命中长度 = 已存前缀里、恰好是本次请求前缀的最长那个。
 * 请求结束后，把本次每个断点之前的前缀都存起来。一个字节不同，后面的就全部失效。
 */
export function simulate(cache: CacheState, request: Request): { readonly cache: CacheState; readonly result: CacheResult } {
  const { text, breakpoints } = serialize(request);
  const hit = cache.prefixes.reduce((best, prefix) => (prefix.length > best && text.startsWith(prefix) ? prefix.length : best), 0);
  const written = breakpoints.map((at) => text.slice(0, at)).filter((prefix) => !cache.prefixes.includes(prefix));
  return {
    cache: { prefixes: [...cache.prefixes, ...written] },
    result: { inputTokens: estimateTokens(text), cachedTokens: estimateTokens(text.slice(0, hit)) },
  };
}

export interface RunSummary {
  readonly perTurn: readonly CacheResult[];
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly hitRate: number;
}

export function summarize(perTurn: readonly CacheResult[]): RunSummary {
  const inputTokens = perTurn.reduce((sum, r) => sum + r.inputTokens, 0);
  const cachedTokens = perTurn.reduce((sum, r) => sum + r.cachedTokens, 0);
  return { perTurn, inputTokens, cachedTokens, hitRate: inputTokens === 0 ? 0 : cachedTokens / inputTokens };
}
