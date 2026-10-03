import { MAX_LINE_BYTES, splitGeneric, splitStrict } from "./jsonl.ts";
import { classify } from "./protocol.ts";
import type { Finding } from "./types.ts";

// 检查一段录下来的 stdout（`pi --mode json ... > out.jsonl`，或者 RPC 子进程的输出）：
// 分帧上有没有坑，这一轮到底成没成，有没有会把子进程挂住的对话框。

export type Captured = "json" | "rpc" | "unknown";

export interface CheckResult {
  readonly mode: Captured;
  readonly lines: number;
  readonly findings: readonly Finding[];
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v);

function parse(line: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const v: unknown = JSON.parse(line);
    return isRecord(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** 会话头的 type 是 "session"（pi `modes/print-mode.ts:122-127` 在 json 模式先写它） */
export function detectMode(lines: readonly string[]): Captured {
  if (lines.length > 0 && parse(lines[0])?.type === "session") return "json";
  return lines.some((l) => parse(l)?.type === "response") ? "rpc" : "unknown";
}

function framing(lines: readonly string[]): Finding[] {
  return lines.flatMap((line, i): Finding[] => {
    const at = i + 1;
    const out: Finding[] = [];
    const pieces = splitGeneric(line).length;
    if (pieces > 1) {
      out.push({ severity: "warn", rule: "unicode-separator", line: at, message: `内容里有 U+2028 / U+2029：通用分行器会切成 ${pieces} 段，每段都解析失败` });
    }
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      out.push({ severity: "warn", rule: "oversize", line: at, message: `单行超过 ${MAX_LINE_BYTES} 字节，按上限读的接入方会丢掉它` });
    }
    if (classify(line).kind === "bad") out.push({ severity: "error", rule: "not-json", line: at, message: "这一行不是带 type 字段的 JSON 对象" });
    return out;
  });
}

/** agent_end 里最后一条助手消息的 stopReason；json 模式下它出错，进程照样退 0 */
function lastStop(lines: readonly string[]): { line: number; stopReason: unknown } | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const v = parse(lines[i]);
    if (v?.type !== "agent_end" || !Array.isArray(v.messages)) continue;
    const last = [...v.messages].reverse().find((m: unknown) => isRecord(m) && m.role === "assistant");
    return { line: i + 1, stopReason: isRecord(last) ? last.stopReason : undefined };
  }
  return undefined;
}

function jsonRun(lines: readonly string[]): Finding[] {
  const end = lastStop(lines);
  if (!end) return [{ severity: "error", rule: "no-agent-end", message: "没有 agent_end：这一轮没跑完（被杀、超时，或者输出被截断）" }];
  if (end.stopReason === "error" || end.stopReason === "aborted") {
    return [{ severity: "error", rule: "run-failed", line: end.line, message: `最后一条助手消息 stopReason=${String(end.stopReason)}；--mode json 的退出码仍是 0` }];
  }
  return [];
}

function rpcRun(lines: readonly string[]): Finding[] {
  return lines.flatMap((line, i): Finding[] => {
    const msg = classify(line);
    if (msg.kind === "dialog" && msg.timeout === undefined) {
      return [{ severity: "warn", rule: "dialog-without-timeout", line: i + 1, message: `${msg.method} 对话框没有超时：宿主不回，子进程就一直等` }];
    }
    if (msg.kind === "response" && !msg.success) {
      return [{ severity: "warn", rule: "failed-response", line: i + 1, message: `${msg.command} 失败：${msg.error ?? "未说明原因"}` }];
    }
    return [];
  });
}

export function checkCaptured(text: string): CheckResult {
  const lines = splitStrict(text);
  const mode = detectMode(lines);
  const tail: Finding[] = text.length > 0 && !text.endsWith("\n") ? [{ severity: "warn", rule: "no-trailing-newline", line: lines.length, message: "最后一行没有换行：进程可能写到一半就没了" }] : [];
  const missingHeader: Finding[] = mode === "unknown" && lines.length > 0 ? [{ severity: "error", rule: "unknown-stream", message: "第一行不是会话头，也没有任何响应：不像 --mode json 或 --mode rpc 的输出" }] : [];
  const run = mode === "json" ? jsonRun(lines) : mode === "rpc" ? rpcRun(lines) : [];
  return { mode, lines: lines.length, findings: [...framing(lines), ...tail, ...missingHeader, ...run] };
}

export const hasErrors = (r: CheckResult) => r.findings.some((f) => f.severity === "error");
