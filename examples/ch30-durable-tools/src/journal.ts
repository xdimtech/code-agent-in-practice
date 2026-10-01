// 第 30 章：一个最小的「意图—结算」工具日志，以及恢复时的校验与折叠。
//
// 校验对应 pi v2 的 packages/agent/src/harness/reducer.ts：
//   - 损坏类别是机器可读的枚举（:22-33），恢复遇到它们只拒绝、不修复（:16-21）；
//   - validateToolStart 检查重复调用和序号/ID 不匹配（:236-270）。
// 这里只保留工具批次相关的几类，其余（队列、压缩、重试序号）同理。

export type Replay = "never" | "safe";

export interface PlannedCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type JournalRecord =
  | { type: "batch_planned"; seq: number; batchId: string; calls: readonly PlannedCall[] }
  | { type: "tool_started"; seq: number; batchId: string; toolIndex: number; toolCallId: string; replay: Replay }
  | {
      type: "tool_settled";
      seq: number;
      batchId: string;
      toolIndex: number;
      toolCallId: string;
      text: string;
      isError: boolean;
    };

/** 写入时还没有 seq，由存储分配 */
type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;
export type NewRecord = WithoutSeq<JournalRecord>;

/** 单写者协议不可能产生的状态。不是「操作失败」，也不是「写到一半」 */
export type CorruptionReason =
  | "non_monotonic_seq"
  | "unknown_batch"
  | "multiple_open_batches"
  | "tool_call_mismatch"
  | "duplicate_tool_invocation"
  | "settled_without_start"
  | "duplicate_settlement";

export class JournalCorruption extends Error {
  readonly reason: CorruptionReason;

  constructor(reason: CorruptionReason, message: string) {
    super(message);
    this.name = "JournalCorruption";
    this.reason = reason;
  }
}

export type CallState =
  | { status: "planned"; toolIndex: number; call: PlannedCall }
  | { status: "effect_pending"; toolIndex: number; call: PlannedCall; replay: Replay }
  | { status: "completed"; toolIndex: number; call: PlannedCall; text: string; isError: boolean };

export interface BatchState {
  batchId: string;
  calls: readonly CallState[];
}

interface Tracked {
  calls: readonly PlannedCall[];
  started: Set<number>;
  settled: Set<number>;
}

const corrupt = (reason: CorruptionReason, message: string): never => {
  throw new JournalCorruption(reason, message);
};

const isOpen = (t: Tracked): boolean => t.settled.size < t.calls.length;

function checkCall(batches: Map<string, Tracked>, r: Extract<JournalRecord, { toolIndex: number }>): Tracked {
  const batch = batches.get(r.batchId) ?? corrupt("unknown_batch", `#${r.seq} 引用了不存在的批次 ${r.batchId}`);
  if (batch.calls[r.toolIndex]?.id !== r.toolCallId) {
    corrupt("tool_call_mismatch", `#${r.seq} 的 ${r.toolIndex}:${r.toolCallId} 与计划不符`);
  }
  return batch;
}

/** 只检查协议不变量；任何一条不成立就抛出，不尝试「修好再继续」 */
export function validate(records: readonly JournalRecord[]): void {
  const batches = new Map<string, Tracked>();
  let lastSeq = 0;
  for (const r of records) {
    if (r.seq <= lastSeq) corrupt("non_monotonic_seq", `#${r.seq} 出现在 #${lastSeq} 之后`);
    lastSeq = r.seq;
    if (r.type === "batch_planned") {
      if ([...batches.values()].some(isOpen)) corrupt("multiple_open_batches", `#${r.seq} 时上一批尚未结算完`);
      batches.set(r.batchId, { calls: r.calls, started: new Set(), settled: new Set() });
      continue;
    }
    const batch = checkCall(batches, r);
    if (r.type === "tool_started") {
      if (batch.started.has(r.toolIndex)) corrupt("duplicate_tool_invocation", `#${r.seq} 重复启动 ${r.toolCallId}`);
      batch.started.add(r.toolIndex);
    } else {
      if (!batch.started.has(r.toolIndex)) corrupt("settled_without_start", `#${r.seq} 结算了未启动的 ${r.toolCallId}`);
      if (batch.settled.has(r.toolIndex)) corrupt("duplicate_settlement", `#${r.seq} 重复结算 ${r.toolCallId}`);
      batch.settled.add(r.toolIndex);
    }
  }
}

function stateOf(records: readonly JournalRecord[], batchId: string, toolIndex: number, call: PlannedCall): CallState {
  const mine = records.filter((r) => r.type !== "batch_planned" && r.batchId === batchId && r.toolIndex === toolIndex);
  const settled = mine.find((r) => r.type === "tool_settled");
  if (settled?.type === "tool_settled") {
    return { status: "completed", toolIndex, call, text: settled.text, isError: settled.isError };
  }
  const started = mine.find((r) => r.type === "tool_started");
  if (started?.type === "tool_started") return { status: "effect_pending", toolIndex, call, replay: started.replay };
  return { status: "planned", toolIndex, call };
}

/** 先校验，再把最近一批折叠成每个调用的状态；没有任何批次时返回 null */
export function restore(records: readonly JournalRecord[]): BatchState | null {
  validate(records);
  const plan = records.findLast((r) => r.type === "batch_planned");
  if (plan?.type !== "batch_planned") return null;
  return {
    batchId: plan.batchId,
    calls: plan.calls.map((call, i) => stateOf(records, plan.batchId, i, call)),
  };
}
