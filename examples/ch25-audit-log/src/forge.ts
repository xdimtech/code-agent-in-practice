// 「篡改的人」会做的几件事，演示和测试共用。每个函数都返回新的文本，不改传进来的东西。

import { headOf, seal, serialize } from "./chain.ts";
import type { AuditRecord, Entry, Head, Signer } from "./types.ts";

export function buildLog(entries: readonly Entry[], signer: Signer, now: (i: number) => string): { text: string; records: AuditRecord[] } {
  const records = entries.reduce<AuditRecord[]>((acc, entry, i) => [...acc, seal(acc.length > 0 ? headOf(acc[acc.length - 1]) : undefined, entry, now(i), signer)], []);
  return { text: records.map(serialize).join(""), records };
}

const lines = (text: string): string[] => text.split("\n").filter((l) => l !== "");
const unlines = (ls: readonly string[]): string => ls.map((l) => `${l}\n`).join("");

/** 直接改第 line 行（从 1 开始）的 JSON 文本，哈希不动 */
export const editLine = (text: string, line: number, edit: (l: string) => string): string => unlines(lines(text).map((l, i) => (i === line - 1 ? edit(l) : l)));

/** 删掉末尾 n 行：剩下的仍是一条完好的链 */
export const dropTail = (text: string, n: number): string => unlines(lines(text).slice(0, -n));

/** 删掉中间一行 */
export const dropLine = (text: string, line: number): string => unlines(lines(text).filter((_l, i) => i !== line - 1));

/** 把第 line 条的内容换掉，再用 signer 把它和后面所有记录重新封一遍——拿得到密钥（或者链本来就没密钥）的人能做到 */
export function reseal(records: readonly AuditRecord[], line: number, body: Entry["body"], signer: Signer): string {
  const kept = records.slice(0, line - 1);
  const start: Head | undefined = kept.length > 0 ? headOf(kept[kept.length - 1]) : undefined;
  const rest = records.slice(line - 1).reduce<AuditRecord[]>((acc, r, i) => {
    const head = acc.length > 0 ? headOf(acc[acc.length - 1]) : start;
    return [...acc, seal(head, { kind: r.kind, body: i === 0 ? body : r.body }, r.at, signer)];
  }, []);
  return [...kept, ...rest].map(serialize).join("");
}
