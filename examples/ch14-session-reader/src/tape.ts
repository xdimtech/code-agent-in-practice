// 读磁带：一行一条记录，按 seq 归成「一次请求 = 请求体 + 响应头 + 助手消息」。
// 磁带和会话文件一样可能是别人发来的，所以逐行校验；和 pi 读会话不同，坏行直接报错而不是跳过。

import type { MessageRecord, RequestRecord, ResponseRecord, TapeRecord } from "./recorder.ts";

export class TapeFormatError extends Error {}

export interface Exchange {
  readonly request: RequestRecord;
  /** SDK 路径上，被重试或最终失败的响应不触发 after_provider_response，这里就是空的 */
  readonly response?: ResponseRecord;
  /** 请求失败时 pi 也会产出一条 stopReason=error 的助手消息 */
  readonly message?: MessageRecord;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function toRecord(v: unknown, line: number): TapeRecord {
  if (!isObject(v) || typeof v.seq !== "number" || !Number.isInteger(v.seq) || v.seq < 1 || typeof v.at !== "string") {
    throw new TapeFormatError(`第 ${line} 行不是磁带记录（缺 seq 或 at）`);
  }
  if (v.kind === "request" && typeof v.fingerprint === "string" && typeof v.sessionId === "string" && "payload" in v) return v as unknown as RequestRecord;
  if (v.kind === "response" && typeof v.status === "number" && isObject(v.headers)) return v as unknown as ResponseRecord;
  if (v.kind === "message" && isObject(v.message)) return v as unknown as MessageRecord;
  throw new TapeFormatError(`第 ${line} 行的 kind 不认识或字段不全`);
}

export function parseTape(text: string): TapeRecord[] {
  return text
    .split("\n")
    .map((raw, i) => ({ raw, line: i + 1 }))
    .filter(({ raw }) => raw.trim() !== "")
    .map(({ raw, line }) => {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new TapeFormatError(`第 ${line} 行不是合法 JSON`);
      }
      return toRecord(value, line);
    });
}

export function exchanges(records: readonly TapeRecord[]): Exchange[] {
  const requests = records.filter((r): r is RequestRecord => r.kind === "request");
  const seen = new Set<number>();
  for (const r of requests) {
    if (seen.has(r.seq)) throw new TapeFormatError(`seq ${r.seq} 出现了两次请求：两盘磁带被写进了同一个文件`);
    seen.add(r.seq);
  }
  for (const r of records) if (!seen.has(r.seq)) throw new TapeFormatError(`seq ${r.seq} 有 ${r.kind} 但没有请求`);
  return requests.map((request) => {
    const response = records.find((r): r is ResponseRecord => r.kind === "response" && r.seq === request.seq);
    const message = records.find((r): r is MessageRecord => r.kind === "message" && r.seq === request.seq);
    return { request, ...(response ? { response } : {}), ...(message ? { message } : {}) };
  });
}

export interface PayloadShape {
  readonly model: string;
  readonly systemChars: number;
  readonly roles: readonly string[];
  readonly tools: number;
}

const systemLength = (v: unknown): number =>
  typeof v === "string" ? v.length : Array.isArray(v) ? v.reduce((n: number, b) => n + (isObject(b) && typeof b.text === "string" ? b.text.length : 0), 0) : 0;

/** 各家 API 的请求体长得不一样；这里只认最常见的几个字段：messages / input、system / instructions、tools */
export function payloadShape(payload: unknown): PayloadShape {
  if (!isObject(payload)) return { model: "?", systemChars: 0, roles: [], tools: 0 };
  const list = Array.isArray(payload.messages) ? payload.messages : Array.isArray(payload.input) ? payload.input : [];
  return {
    model: typeof payload.model === "string" ? payload.model : "?",
    systemChars: systemLength(payload.system ?? payload.instructions),
    roles: list.map((m) => (isObject(m) && typeof m.role === "string" ? m.role : isObject(m) && typeof m.type === "string" ? m.type : "?")),
    tools: Array.isArray(payload.tools) ? payload.tools.length : 0,
  };
}
