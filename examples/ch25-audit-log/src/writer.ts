// 写入器：记住链尾，一条条往后接。两条规矩：
// 1. 打开时先校验已有的日志，校验不过就不往后写——接在一条断链后面的记录，证明不了任何事；
// 2. 写失败一次就进入「降级」，之后一律不写，由调用方决定怎么办（扩展里是拦下后续的工具调用）。

import { seal, serialize, signerFor } from "./chain.ts";
import type { AuditRecord, Entry, Head, Signer } from "./types.ts";
import { passed, verifyLog } from "./verify.ts";

/** 读写只经过这两个口子，测试和演示换成内存里的 */
export interface LogIo {
  /** 文件不存在返回 undefined */
  read(): string | undefined;
  append(text: string): void;
}

export interface WriterOptions {
  readonly io: LogIo;
  readonly key?: Buffer;
  readonly now: () => string;
}

export interface AuditWriter {
  append(entry: Entry): AuditRecord | undefined;
  /** 降级原因；正常时 undefined */
  degraded(): string | undefined;
  head(): Head | undefined;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 打开时的状态：要么拿到链尾，要么拿到不能写的原因 */
function inspectExisting(io: LogIo, signer: Signer): { head?: Head; refused?: string } {
  let text: string | undefined;
  try {
    text = io.read();
  } catch (e) {
    return { refused: `读不了已有日志：${message(e)}` };
  }
  if (text === undefined || text === "") return {};
  const v = verifyLog(text, signer.key ? { key: signer.key } : {});
  const first = v.findings.find((f) => f.severity === "error");
  if (!passed(v)) return { refused: `已有日志校验不过（第 ${first?.line ?? "?"} 行 ${first?.rule}）：${first?.message}` };
  if (!signer.key && v.records.some((r) => r.alg === "hmac-sha256")) return { refused: "已有日志是 HMAC 记录，现在没有密钥：不能往后接 sha256 记录" };
  return v.head ? { head: v.head } : {};
}

export function openAuditWriter(options: WriterOptions): AuditWriter {
  const signer = signerFor(options.key);
  const opened = inspectExisting(options.io, signer);
  let head = opened.head;
  let degraded = opened.refused;
  return {
    append(entry) {
      if (degraded) return undefined;
      try {
        const record = seal(head, entry, options.now(), signer);
        options.io.append(serialize(record));
        head = { seq: record.seq, hash: record.hash };
        return record;
      } catch (e) {
        degraded = `写入失败：${message(e)}`;
        return undefined;
      }
    },
    degraded: () => degraded,
    head: () => head,
  };
}
