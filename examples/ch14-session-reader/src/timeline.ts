// 把条目压成一行一条的时间线：排障时先看「发生了什么」，再去翻某一条的原文。

import { isAssistant, isBashExecution, isToolResult, isUser, type ContentPart, type Entry } from "./types.ts";

export const PREVIEW_CHARS = 48;

const clip = (s: string, n = PREVIEW_CHARS) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

const textOf = (content: string | readonly ContentPart[]) =>
  typeof content === "string" ? content : content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(" ");

const imagesIn = (content: string | readonly ContentPart[]) =>
  typeof content === "string" ? 0 : content.filter((c) => c.type === "image").length;

function describeMessage(e: Entry): string {
  const m = e.message;
  if (isUser(m)) {
    const images = imagesIn(m.content);
    return `user       ${clip(textOf(m.content))}${images ? ` [+${images} 张图]` : ""}`;
  }
  if (isAssistant(m)) {
    const calls = m.content.flatMap((c) => (c.type === "toolCall" ? [`${c.name}(${clip(JSON.stringify(c.arguments), 32)})`] : []));
    const text = clip(textOf(m.content), 32);
    const body = [text, ...calls].filter(Boolean).join(" → ");
    const error = m.errorMessage ? ` ✗ ${clip(m.errorMessage, 40)}` : "";
    return `assistant  [${m.stopReason}] ${body}${error}`;
  }
  if (isToolResult(m)) return `toolResult ${m.isError ? "✗" : "✓"} ${m.toolName}: ${clip(textOf(m.content), 40)}`;
  if (isBashExecution(m)) {
    return `!bash      ${m.command} → exit ${m.exitCode ?? "?"}${m.truncated ? `（截断，全文在 ${m.fullOutputPath ?? "?"}）` : ""}`;
  }
  return `${m?.role ?? "?"}`;
}

export function describe(e: Entry): string {
  switch (e.type) {
    case "message":
      return describeMessage(e);
    case "compaction":
      return `compaction 压缩前 ${e.tokensBefore ?? "?"} tokens，保留自 ${e.firstKeptEntryId ?? "?"}：${clip(e.summary ?? "", 32)}`;
    case "branch_summary":
      return `branch     分支摘要：${clip(e.summary ?? "", 40)}`;
    case "model_change":
      return `model      → ${e.provider}/${e.modelId}`;
    case "thinking_level_change":
      return `thinking   → ${String(e.thinkingLevel)}`;
    default:
      return `${e.type.padEnd(10)} ${typeof e.customType === "string" ? e.customType : ""}`.trimEnd();
  }
}

export interface TimelineOptions {
  /** 不在上下文里的条目（被压缩掉的）前面打个标记 */
  readonly inContext?: ReadonlySet<string>;
}

export function timeline(path: readonly Entry[], options: TimelineOptions = {}): string[] {
  return path.map((e) => {
    const time = e.timestamp.slice(11, 19);
    const mark = options.inContext && !options.inContext.has(e.id) ? "░" : " ";
    return `${mark} ${time} ${e.id} ${describe(e)}`;
  });
}
