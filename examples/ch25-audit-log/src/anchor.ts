// 锚点：把链尾的 {seq, hash} 抄到日志之外（另一台机器、只追加的存储、工单系统）。
// 只有日志本身的话，删掉末尾几条剩下的仍是一条完好的链；重算整条 sha256 链也一样。锚点让这两件事露馅。

import { type Anchor, type Head, InputError } from "./types.ts";

const HEX64 = /^[0-9a-f]{64}$/;

export const makeAnchor = (head: Head, at: string): Anchor => ({ seq: head.seq, hash: head.hash, at });

export const serializeAnchor = (anchor: Anchor): string => `${JSON.stringify(anchor)}\n`;

export function parseAnchor(text: string, source = "锚点"): Anchor {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError(`${source} 不是 JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InputError(`${source} 不是 JSON 对象`);
  const { seq, hash, at } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) throw new InputError(`${source} 的 seq 不是正整数`);
  if (typeof hash !== "string" || !HEX64.test(hash)) throw new InputError(`${source} 的 hash 不是 64 位十六进制`);
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new InputError(`${source} 的 at 不是时间`);
  return { seq: seq as number, hash, at };
}
