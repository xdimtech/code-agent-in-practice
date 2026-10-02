// 拿一份 pi 会话文件，列出它能证明什么、不能证明什么。不改文件，不跟 pi 的加载器走同一条路：
// pi 加载时会跳过坏行（core/session-manager.ts:508）、给缺换行的末行补换行（:555）、旧版本迁移后整文件重写（:919），
// 这里把这些都报出来，而不是替它们圆过去。

import type { Finding } from "./types.ts";

/** pi 当前的会话版本（core/session-manager.ts:30） */
export const PI_SESSION_VERSION = 3;

export interface SessionFacts {
  readonly entries: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly toolErrors: number;
  readonly userBash: number;
  readonly externalOutputs: readonly string[];
  readonly images: number;
  readonly imageBytes: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

function parseLines(text: string): { rows: { line: number; value: Obj }[]; bad: number[]; lastHasNewline: boolean } {
  const parts = text.split("\n");
  const lastHasNewline = parts.at(-1) === "";
  const rows: { line: number; value: Obj }[] = [];
  const bad: number[] = [];
  for (const [i, raw] of parts.entries()) {
    if (!raw.trim()) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (isObj(value)) rows.push({ line: i + 1, value });
      else bad.push(i + 1);
    } catch {
      bad.push(i + 1);
    }
  }
  return { rows, bad, lastHasNewline };
}

const messageOf = (entry: Obj): Obj | undefined => (entry.type === "message" && isObj(entry.message) ? entry.message : undefined);

/** toolResult 的 details.fullOutputPath，或者用户 ! 命令（bashExecution）的 fullOutputPath */
function fullOutputPath(m: Obj): string | undefined {
  if (m.role === "bashExecution" && typeof m.fullOutputPath === "string") return m.fullOutputPath;
  if (m.role === "toolResult" && isObj(m.details) && typeof m.details.fullOutputPath === "string") return m.details.fullOutputPath;
  return undefined;
}

/** 被拦下的调用：pi 给的结果是 {content:[text], details:{}}，和工具自己抛错一模一样（agent/src/agent-loop.ts:758-763） */
const looksBareError = (m: Obj): boolean => m.role === "toolResult" && m.isError === true && isObj(m.details) && Object.keys(m.details).length === 0;

function collectFacts(messages: readonly Obj[], entries: number): SessionFacts {
  const images = messages.flatMap((m) => asArray(m.content).filter((p) => isObj(p) && p.type === "image" && typeof p.data === "string")) as Obj[];
  return {
    entries,
    toolCalls: messages.flatMap((m) => (m.role === "assistant" ? asArray(m.content).filter((p) => isObj(p) && p.type === "toolCall") : [])).length,
    toolResults: messages.filter((m) => m.role === "toolResult").length,
    toolErrors: messages.filter((m) => m.role === "toolResult" && m.isError === true).length,
    userBash: messages.filter((m) => m.role === "bashExecution").length,
    externalOutputs: messages.flatMap((m) => fullOutputPath(m) ?? []),
    images: images.length,
    imageBytes: images.reduce((n, p) => n + Math.floor(((p.data as string).length * 3) / 4), 0),
  };
}

function structureFindings(rows: readonly { line: number; value: Obj }[], bad: readonly number[], lastHasNewline: boolean): Finding[] {
  const header = rows[0]?.value;
  const ids = new Set(rows.flatMap((r) => (typeof r.value.id === "string" ? [r.value.id] : [])));
  const orphans = rows.filter((r) => r.value.type !== "session" && typeof r.value.parentId === "string" && !ids.has(r.value.parentId));
  const version = typeof header?.version === "number" ? header.version : 1;
  return [
    ...bad.map((line): Finding => ({ severity: "warn", rule: "malformed-line", line, message: "不是 JSON 对象：pi 加载时悄悄跳过这一行" })),
    ...(!lastHasNewline ? [{ severity: "warn" as const, rule: "no-trailing-newline", message: "末行没有换行：pi 加载时会往文件末尾补一个——读一次，文件就变了" }] : []),
    ...(header?.type !== "session" ? [{ severity: "error" as const, rule: "no-header", line: rows[0]?.line, message: "第一条不是会话头：pi 当作空会话" }] : []),
    ...(header?.type === "session" && version < PI_SESSION_VERSION
      ? [{ severity: "warn" as const, rule: "old-version", line: rows[0]?.line, message: `版本 ${version}：pi 打开时迁移，原地重写整个文件（v1→v2 还会重新生成所有 id）` }]
      : []),
    ...orphans.map((r): Finding => ({ severity: "warn", rule: "orphan-parent", line: r.line, message: `parentId ${String(r.value.parentId)} 找不到：前面有条目被删过，或者文件是拼出来的` })),
  ];
}

function contentFindings(rows: readonly { line: number; value: Obj }[], facts: SessionFacts): Finding[] {
  const bare = rows.filter((r) => {
    const m = messageOf(r.value);
    return m !== undefined && looksBareError(m);
  });
  return [
    ...facts.externalOutputs.map((path): Finding => ({ severity: "warn", rule: "external-output", message: `完整输出在会话之外：${path}——会话里只有截断后的部分，那个文件不随会话保存、也没有校验` })),
    ...bare.map((r): Finding => ({ severity: "info", rule: "bare-error", line: r.line, message: "工具报错且 details 为空：是策略拦下的，还是工具自己失败的，会话里分不出来" })),
    ...(facts.images > 0 ? [{ severity: "info" as const, rule: "inline-image", message: `${facts.images} 张图片按 base64 内联，约 ${facts.imageBytes} 字节` }] : []),
    ...(facts.toolCalls > 0 ? [{ severity: "info" as const, rule: "proposed-args", message: `${facts.toolCalls} 次工具调用记的是模型给的参数，不是执行时的那份` }] : []),
    { severity: "info", rule: "no-integrity", message: "条目没有哈希、没有签名：改一行、删末尾几行，加载时都看不出来" },
  ];
}

export function inspectSession(text: string): { facts: SessionFacts; findings: Finding[] } {
  const { rows, bad, lastHasNewline } = parseLines(text);
  const messages = rows.flatMap((r) => messageOf(r.value) ?? []);
  const facts = collectFacts(messages, rows.length);
  return { facts, findings: [...structureFindings(rows, bad, lastHasNewline || text === ""), ...contentFindings(rows, facts)] };
}
