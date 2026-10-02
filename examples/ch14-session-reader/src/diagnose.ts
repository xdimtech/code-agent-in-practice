// 排障时先看的那几件事，按严重程度列出来。
// 高：这次会话里确实出了错，或者文件结构坏了，pi 读出来的对话和你以为的不一样；
// 中：没报错，但很可能是问题所在；提示：读记录时需要知道的背景。

import type { ParsedSession } from "./jsonl.ts";
import { pathTo, type SessionTree } from "./tree.ts";
import { isAssistant, isBashExecution, isToolResult, type Entry, type ToolCallPart } from "./types.ts";

export type Severity = "高" | "中" | "提示";

export interface Finding {
  readonly severity: Severity;
  readonly code: string;
  readonly entryId?: string;
  readonly message: string;
}

/** 一条对话里同一个工具、同样的参数调到这么多次，就当它在原地打转（中间夹着别的调用也算） */
export const REPEAT_THRESHOLD = 3;

const RANK: Record<Severity, number> = { 高: 0, 中: 1, 提示: 2 };
const finding = (severity: Severity, code: string, message: string, entryId?: string): Finding => ({ severity, code, message, entryId });

const toolCalls = (e: Entry): ToolCallPart[] =>
  isAssistant(e.message) ? e.message.content.filter((c): c is ToolCallPart => c.type === "toolCall") : [];

function structureFindings(parsed: ParsedSession, tree: SessionTree): Finding[] {
  return [
    ...parsed.problems.map((p) => finding("高", `line:${p.kind}`, `第 ${p.line} 行被跳过（${p.detail}）`)),
    ...tree.duplicateIds.map((id) => finding("高", "tree:duplicate-id", `id ${id} 出现不止一次，后写的覆盖先写的`, id)),
    ...tree.danglingParents.map((d) => finding("高", "tree:dangling-parent", `${d.id} 的父条目 ${d.parentId} 不在文件里，之前的历史接不上`, d.id)),
    ...(tree.cycleAt ? [finding("高", "tree:cycle", `沿 parentId 回走在 ${tree.cycleAt} 绕成环，pi 打开它会卡死`, tree.cycleAt)] : []),
    ...(parsed.needsMigration ? [finding("提示", "file:migration", `版本 ${parsed.header.version ?? 1}：pi 打开时会迁移并整体重写这个文件`)] : []),
    ...(parsed.missingTrailingNewline ? [finding("提示", "file:no-newline", "末行没有换行符，进程可能是写到一半退出的")] : []),
  ];
}

function assistantFindings(path: readonly Entry[]): Finding[] {
  return path.flatMap((e) => {
    const m = e.message;
    if (!isAssistant(m)) return [];
    const out: Finding[] = [];
    if (m.stopReason === "error" || m.stopReason === "aborted") {
      out.push(finding("高", `stop:${m.stopReason}`, `${m.provider}/${m.model} ${m.stopReason}：${m.errorMessage ?? "（没有 errorMessage）"}`, e.id));
    }
    if (m.stopReason === "length") out.push(finding("中", "stop:length", "输出到上限被截断，后面的工具调用可能是半截的", e.id));
    if (m.responseModel && m.responseModel !== m.model) {
      out.push(finding("提示", "model:routed", `请求的是 ${m.model}，实际回答的是 ${m.responseModel}`, e.id));
    }
    return out;
  });
}

function toolFindings(path: readonly Entry[]): Finding[] {
  const results = new Map(path.flatMap((e) => (isToolResult(e.message) ? [[e.message.toolCallId, e] as const] : [])));
  const out: Finding[] = [];
  const seen = new Map<string, { count: number; from: string }>();
  for (const e of path) {
    for (const call of toolCalls(e)) {
      const result = results.get(call.id)?.message;
      if (!result) out.push(finding("高", "tool:orphan-call", `${call.name}(${call.id}) 没有结果：工具执行中会话就断了`, e.id));
      else if (isToolResult(result) && result.isError) out.push(finding("中", "tool:error", `${call.name} 返回错误`, e.id));
      const key = `${call.name}:${JSON.stringify(call.arguments)}`;
      const prev = seen.get(key);
      const now = { count: (prev?.count ?? 0) + 1, from: prev?.from ?? e.id };
      seen.set(key, now);
      if (now.count === REPEAT_THRESHOLD) {
        out.push(finding("中", "tool:repeat", `${call.name} 同样的参数第 ${REPEAT_THRESHOLD} 次调用（第一次在 ${now.from}）`, e.id));
      }
    }
    const m = e.message;
    if (isBashExecution(m) && m.truncated) {
      out.push(finding("提示", "bash:truncated", `!${m.command} 的完整输出不在会话里，只在 ${m.fullOutputPath ?? "（无路径）"}`, e.id));
    }
  }
  return out;
}

const DOWNGRADE: Record<Severity, Severity> = { 高: "中", 中: "提示", 提示: "提示" };

/** 被放弃的分支也要读：用户往回退，往往就是因为那边出了事。整条从根读起，只报分支上那几条，降一级 */
function abandonedFindings(tree: SessionTree): Finding[] {
  const off = new Set(tree.offPath.map((e) => e.id));
  const seen = new Set<string>();
  return tree.abandonedLeaves.flatMap((leaf) => {
    const path = pathTo(tree, leaf);
    return [...assistantFindings(path), ...toolFindings(path)]
      .filter((f) => f.entryId !== undefined && off.has(f.entryId))
      .filter((f) => !seen.has(`${f.code}:${f.entryId}`) && seen.add(`${f.code}:${f.entryId}`))
      .map((f) => ({ ...f, severity: DOWNGRADE[f.severity], message: `［已放弃的分支］${f.message}` }));
  });
}

function branchFindings(tree: SessionTree): Finding[] {
  const n = tree.offPath.length;
  const ctx = tree.activePath.length - tree.context.length;
  return [
    ...(n > 0 ? [finding("提示", "tree:off-path", `${n} 个条目不在当前对话上（被放弃的分支），但算进了花费`)] : []),
    ...(ctx > 0 ? [finding("提示", "context:compacted", `当前对话里有 ${ctx} 个条目已被压缩，模型看不到原文`)] : []),
  ];
}

export function diagnose(parsed: ParsedSession, tree: SessionTree): Finding[] {
  return [
    ...structureFindings(parsed, tree),
    ...assistantFindings(tree.activePath),
    ...toolFindings(tree.activePath),
    ...abandonedFindings(tree),
    ...branchFindings(tree),
  ].sort((a, b) => RANK[a.severity] - RANK[b.severity]); // sort 是稳定的，同级保持出现顺序
}

export const hasBlocking = (findings: readonly Finding[]) => findings.some((f) => f.severity === "高");
