// 把会话 JSONL 读成结构。pi 读文件时遇到坏行一律静默跳过（core/session-manager.ts:503-511），
// 读的人就不知道少了什么；这里照样跳过，但把行号和原因记下来。

import type { Entry, SessionHeader } from "./types.ts";

export const CURRENT_SESSION_VERSION = 3; // core/session-manager.ts:30

export class SessionFormatError extends Error {}

export type ProblemKind = "malformed-json" | "not-an-entry" | "extra-header";

export interface Problem {
  readonly line: number;
  readonly kind: ProblemKind;
  readonly detail: string;
}

export interface ParsedSession {
  readonly header: SessionHeader;
  readonly entries: readonly Entry[];
  readonly problems: readonly Problem[];
  /** 版本低于 3 时，pi 打开文件会就地迁移并整个重写（:918-920） */
  readonly needsMigration: boolean;
  /** 最后一行没有换行符时，pi 打开文件会先补一个 "\n"（:555） */
  readonly missingTrailingNewline: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isHeader(v: unknown): v is SessionHeader {
  return isRecord(v) && v.type === "session" && typeof v.id === "string";
}

function entryShapeError(v: unknown): string | undefined {
  if (!isRecord(v)) return "不是 JSON 对象";
  if (typeof v.type !== "string") return "缺 type";
  if (typeof v.id !== "string" || v.id === "") return "缺 id";
  if (v.parentId !== null && typeof v.parentId !== "string") return "parentId 既不是字符串也不是 null";
  if (typeof v.timestamp !== "string") return "缺 timestamp";
  if (v.type === "message" && (!isRecord(v.message) || typeof v.message.role !== "string")) return "message 条目缺 message.role";
  return undefined;
}

const preview = (line: string) => (line.length > 40 ? `${line.slice(0, 40)}…` : line);

export function parseSession(text: string): ParsedSession {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const entries: Entry[] = [];
  const problems: Problem[] = [];
  let header: SessionHeader | undefined;

  lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      problems.push({ line, kind: "malformed-json", detail: `半截或损坏的 JSON：${preview(raw)}` });
      return;
    }
    if (isHeader(value)) {
      if (header) problems.push({ line, kind: "extra-header", detail: "第二个会话头" });
      else header = value;
      return;
    }
    if (!header) throw new SessionFormatError(`第 ${line} 行不是会话头：pi 会拒绝打开这个文件（:550-553、:903-907）`);
    const error = entryShapeError(value);
    if (error) problems.push({ line, kind: "not-an-entry", detail: error });
    else entries.push(value as Entry);
  });

  if (!header) throw new SessionFormatError("文件是空的或没有会话头");
  return {
    header,
    entries,
    problems,
    needsMigration: (header.version ?? 1) < CURRENT_SESSION_VERSION,
    missingTrailingNewline: text.length > 0 && !text.endsWith("\n"),
  };
}
