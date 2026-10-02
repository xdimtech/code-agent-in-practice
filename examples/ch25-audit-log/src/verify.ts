// 校验一份审计日志。逐行往下走，遇到第一处断裂就停：断点之后的记录即使彼此链得上，也可能是整段重写的，
// 一律不可信。返回值里的 records 只含断点之前的那一段。

import { canonicalJson } from "./canonical.ts";
import { digest, hashInput, headOf, KIND_PATTERN } from "./chain.ts";
import { type Alg, type Anchor, type AuditRecord, type Finding, GENESIS, type Head, RECORD_VERSION } from "./types.ts";

export interface VerifyOptions {
  /** 有密钥就要求每一条都是 HMAC；没有密钥，HMAC 记录只能查序号和前后链接 */
  readonly key?: Buffer;
  readonly anchor?: Anchor;
}

export interface Verification {
  readonly records: readonly AuditRecord[];
  readonly head?: Head;
  readonly findings: readonly Finding[];
  readonly lines: number;
  /** 第一处断裂的行号 */
  readonly brokenAt?: number;
}

const HEX64 = /^[0-9a-f]{64}$/;
const FIELDS = ["alg", "at", "body", "hash", "kind", "prev", "seq", "v"];
const ALGS: readonly Alg[] = ["sha256", "hmac-sha256"];

/** 形状不对返回原因，对了返回记录 */
function parseRecord(value: unknown): AuditRecord | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "不是 JSON 对象";
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(",");
  if (keys !== FIELDS.join(",")) return `字段应为 ${FIELDS.join("、")}，实际是 ${keys || "（空）"}`;
  if (r.v !== RECORD_VERSION) return `v 应为 ${RECORD_VERSION}`;
  if (!Number.isSafeInteger(r.seq) || (r.seq as number) < 1) return "seq 不是正整数";
  if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) return "at 不是时间";
  if (typeof r.prev !== "string" || !HEX64.test(r.prev)) return "prev 不是 64 位十六进制";
  if (typeof r.hash !== "string" || !HEX64.test(r.hash)) return "hash 不是 64 位十六进制";
  if (typeof r.kind !== "string" || !KIND_PATTERN.test(r.kind)) return "kind 不合规";
  if (!ALGS.includes(r.alg as Alg)) return `alg 只能是 ${ALGS.join(" 或 ")}`;
  return r as unknown as AuditRecord;
}

const error = (rule: string, line: number, message: string): Finding => ({ severity: "error", rule, line, message });

/** 检查一行；previous 是上一条已经通过的记录 */
function checkLine(text: string, line: number, previous: AuditRecord | undefined, key: Buffer | undefined): AuditRecord | Finding {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return error("bad-json", line, "不是 JSON");
  }
  const record = parseRecord(parsed);
  if (typeof record === "string") return error("bad-shape", line, record);
  if (canonicalJson(record) !== text) return error("non-canonical", line, "和写入器写出的样子不一样（键序、空白或重复键被动过）");
  const expectedSeq = previous ? previous.seq + 1 : 1;
  if (record.seq !== expectedSeq) return error("seq-gap", line, `seq 应为 ${expectedSeq}，实际是 ${record.seq}`);
  const expectedPrev = previous ? previous.hash : GENESIS;
  if (record.prev !== expectedPrev) return error("prev-mismatch", line, "prev 和上一条的 hash 对不上：中间被删、插或换过");
  if (key && record.alg !== "hmac-sha256") return error("alg-mismatch", line, `有密钥时每条都应是 HMAC，这条是 ${record.alg}：谁都能重算的记录混进来了`);
  if (!key && record.alg === "hmac-sha256") return record; // 没有密钥，哈希验不了，只查到这里
  const { hash, ...unsigned } = record;
  if (digest({ alg: record.alg, key }, hashInput(unsigned)) !== hash) return error("hash-mismatch", line, "内容和 hash 对不上：这一条被改过");
  return record;
}

function splitLines(text: string): { lines: string[]; partial: boolean } {
  const lines = text.split("\n");
  const last = lines.pop();
  return last === "" || last === undefined ? { lines, partial: false } : { lines: [...lines, last], partial: true };
}

function anchorFindings(anchor: Anchor, records: readonly AuditRecord[], broken: boolean): Finding[] {
  const last = records.at(-1);
  const hit = records.find((r) => r.seq === anchor.seq);
  if (hit && hit.hash !== anchor.hash) return [{ severity: "error", rule: "anchor-mismatch", message: `第 ${anchor.seq} 条的 hash 和锚点不一样：这一条或它之前的记录被重写过` }];
  if (hit) {
    const after = (last?.seq ?? 0) - anchor.seq;
    return after > 0 ? [{ severity: "info", rule: "after-anchor", message: `锚点之后还有 ${after} 条：这几条被整段删掉的话查不出来，锚点要定期更新` }] : [];
  }
  if (broken) return []; // 断点之前没走到锚点，断裂已经报过
  return [{ severity: "error", rule: "anchor-beyond-tail", message: `锚点记到第 ${anchor.seq} 条，日志只有 ${last?.seq ?? 0} 条：末尾被截掉了` }];
}

function summaryFindings(records: readonly AuditRecord[], key: Buffer | undefined): Finding[] {
  const hmac = records.filter((r) => r.alg === "hmac-sha256").length;
  const plain = records.length - hmac;
  return [
    ...(!key && hmac > 0 ? [{ severity: "warn" as const, rule: "missing-key", message: `${hmac} 条 HMAC 记录没有密钥验不了哈希，只查了序号和前后链接` }] : []),
    ...(plain > 0 ? [{ severity: "info" as const, rule: "unkeyed", message: `${plain} 条是 sha256：能发现意外损坏；改了内容再把后面的哈希全部重算，这里查不出来` }] : []),
  ];
}

export function verifyLog(text: string, options: VerifyOptions = {}): Verification {
  const { lines, partial } = splitLines(text);
  const records: AuditRecord[] = [];
  let broken: Finding | undefined;
  for (const [i, line] of lines.entries()) {
    if (partial && i === lines.length - 1) {
      broken = error("trailing-partial", i + 1, "最后一行没有换行：上次写到一半");
      break;
    }
    const result = checkLine(line, i + 1, records.at(-1), options.key);
    if ("severity" in result) {
      broken = result;
      break;
    }
    records.push(result);
  }
  const rest = broken ? lines.length - (broken.line ?? 0) : 0;
  const findings: Finding[] = [
    ...(lines.length === 0 ? [{ severity: "warn" as const, rule: "empty", message: "日志是空的" }] : []),
    ...(broken ? [broken, { severity: "error" as const, rule: "untrusted-from", line: broken.line, message: `从第 ${broken.line} 行起不可信${rest > 0 ? `，后面 ${rest} 行没有再查` : ""}` }] : []),
    ...(options.anchor ? anchorFindings(options.anchor, records, broken !== undefined) : []),
    ...summaryFindings(records, options.key),
  ];
  const last = records.at(-1);
  return { records, findings, lines: lines.length, ...(last ? { head: headOf(last) } : {}), ...(broken ? { brokenAt: broken.line } : {}) };
}

export const passed = (v: Verification): boolean => v.findings.every((f) => f.severity !== "error");
