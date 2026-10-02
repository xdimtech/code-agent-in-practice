// 测试用的条目构造器：只填测试关心的字段，其余给合理缺省值。
import type { Entry, Usage } from "./types.ts";

export const HEADER = { type: "session", version: 3, id: "s-1", timestamp: "2026-09-30T02:14:05.000Z", cwd: "/w" } as const;

export const usage = (input: number, output: number, total: number): Usage => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});

const base = (id: string, parentId: string | null, type = "message") => ({ type, id, parentId, timestamp: "2026-09-30T02:14:05.000Z" });

export const user = (id: string, parentId: string | null, text = "hi"): Entry => ({
  ...base(id, parentId),
  message: { role: "user", content: text, timestamp: 0 },
});

export interface AssistantOpts {
  readonly calls?: readonly { id: string; name: string; args: Record<string, unknown> }[];
  readonly stopReason?: string;
  readonly errorMessage?: string;
  readonly model?: string;
  readonly responseModel?: string;
  readonly cost?: number;
}

export const assistant = (id: string, parentId: string | null, o: AssistantOpts = {}): Entry => ({
  ...base(id, parentId),
  message: {
    role: "assistant",
    content: (o.calls ?? []).map((c) => ({ type: "toolCall" as const, id: c.id, name: c.name, arguments: c.args })),
    provider: "p",
    model: o.model ?? "m",
    ...(o.responseModel ? { responseModel: o.responseModel } : {}),
    usage: usage(10, 1, o.cost ?? 0.01),
    stopReason: o.stopReason ?? (o.calls?.length ? "toolUse" : "stop"),
    ...(o.errorMessage ? { errorMessage: o.errorMessage } : {}),
    timestamp: 0,
  },
});

export const result = (id: string, parentId: string, toolCallId: string, isError = false): Entry => ({
  ...base(id, parentId),
  message: { role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text: "ok" }], isError, timestamp: 0 },
});

export const compaction = (id: string, parentId: string, firstKeptEntryId: string, cost = 0): Entry => ({
  ...base(id, parentId, "compaction"),
  summary: "s",
  firstKeptEntryId,
  tokensBefore: 100,
  ...(cost ? { usage: usage(5, 5, cost) } : {}),
});

export const jsonl = (...rows: readonly unknown[]) => rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";
