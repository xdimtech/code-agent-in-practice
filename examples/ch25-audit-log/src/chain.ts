// 封一条记录：接在链尾后面，算哈希。纯函数，时间由调用方给。

import { createHash, createHmac } from "node:crypto";
import { canonicalJson, toJson } from "./canonical.ts";
import { type AuditRecord, type Entry, GENESIS, type Head, RECORD_VERSION, type Signer } from "./types.ts";

export const KIND_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

export function signerFor(key: Buffer | undefined): Signer {
  return key ? { alg: "hmac-sha256", key } : { alg: "sha256" };
}

export function digest(signer: Signer, text: string): string {
  if (signer.alg === "sha256") return createHash("sha256").update(text).digest("hex");
  if (!signer.key) throw new Error("hmac-sha256 需要密钥");
  return createHmac("sha256", signer.key).update(text).digest("hex");
}

/** 哈希覆盖除 hash 之外的所有字段，包括 alg——把 hmac 改成 sha256 也会改掉哈希的输入 */
export const hashInput = (record: Omit<AuditRecord, "hash">): string => canonicalJson(record);

export function seal(head: Head | undefined, entry: Entry, at: string, signer: Signer): AuditRecord {
  if (!KIND_PATTERN.test(entry.kind)) throw new Error(`记录种类不合规：${JSON.stringify(entry.kind)}`);
  const unsigned = {
    v: RECORD_VERSION,
    seq: head ? head.seq + 1 : 1,
    at,
    prev: head ? head.hash : GENESIS,
    kind: entry.kind,
    body: toJson(entry.body),
    alg: signer.alg,
  } as const;
  return { ...unsigned, hash: digest(signer, hashInput(unsigned)) };
}

/** 一条记录在文件里的样子：规范 JSON 加换行。校验时也拿这个比，格式被动过就算不一致 */
export const serialize = (record: AuditRecord): string => `${canonicalJson(record)}\n`;

export const headOf = (record: AuditRecord): Head => ({ seq: record.seq, hash: record.hash });
