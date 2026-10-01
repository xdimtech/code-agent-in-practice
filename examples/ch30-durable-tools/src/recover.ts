// 第 30 章：按「意图—副作用—结算」三步执行工具批次，并在重启后接着跑。
//
// 恢复策略对应 pi v2 规格 packages/agent/docs/harness.md §0.5 与 §4.5：
//   - 已结算的调用永不重新结算；
//   - 意图已落盘、结算缺失（effect_pending）的调用，只有当落盘时的声明
//     **和**当前工具的声明都是 "safe" 才重跑，否则在预留的位置补一条
//     「已中断」错误结果；
//   - 还没写意图的调用（planned）照常执行。
// 工具未声明 replay 时按 "never" 处理（规格 §5.7）。

import { restore, type CallState, type JournalRecord, type NewRecord, type PlannedCall, type Replay } from "./journal.ts";

export const INTERRUPTED = "已中断：进程在工具执行期间退出，结果未知，未重试";

export interface Tool {
  name: string;
  replay?: Replay;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface Store {
  read(): readonly JournalRecord[];
  commit(record: NewRecord): void;
}

/** 内存存储：每次提交整体替换数组，读出的是副本 */
export class MemoryStore implements Store {
  private records: readonly JournalRecord[];

  constructor(initial: readonly JournalRecord[] = []) {
    this.records = [...initial];
  }

  read(): readonly JournalRecord[] {
    return [...this.records];
  }

  commit(record: NewRecord): void {
    const seq = (this.records.at(-1)?.seq ?? 0) + 1;
    this.records = [...this.records, { ...record, seq } as JournalRecord];
  }
}

export function planBatch(store: Store, batchId: string, calls: readonly PlannedCall[]): void {
  store.commit({ type: "batch_planned", batchId, calls });
}

async function settle(store: Store, batchId: string, s: CallState, run: () => Promise<string>): Promise<void> {
  const base = { type: "tool_settled", batchId, toolIndex: s.toolIndex, toolCallId: s.call.id } as const;
  try {
    store.commit({ ...base, text: await run(), isError: false });
  } catch (error) {
    store.commit({ ...base, text: error instanceof Error ? error.message : String(error), isError: true });
  }
}

const unknownTool = (name: string) => async (): Promise<string> => {
  throw new Error(`未知工具：${name}`);
};

async function advance(store: Store, batchId: string, s: CallState, tools: ReadonlyMap<string, Tool>): Promise<void> {
  const tool = tools.get(s.call.name);
  const run = tool ? () => tool.execute(s.call.args) : unknownTool(s.call.name);
  if (s.status === "completed") return;
  if (s.status === "effect_pending") {
    const replayable = s.replay === "safe" && tool?.replay === "safe";
    await settle(store, batchId, s, replayable ? run : async () => Promise.reject(new Error(INTERRUPTED)));
    return;
  }
  // 意图先落盘：之后无论在哪一刻崩溃，重启都能看出「这个调用可能已经产生了副作用」
  store.commit({ type: "tool_started", batchId, toolIndex: s.toolIndex, toolCallId: s.call.id, replay: tool?.replay ?? "never" });
  await settle(store, batchId, s, run);
}

/**
 * 从存储里恢复最近一批并推进到全部结算。
 * 正常执行与重启后恢复走的是同一个函数——恢复不是另一套逻辑。
 * 日志损坏时 restore 抛出 JournalCorruption，此时一条记录都不会写。
 */
export async function drive(store: Store, toolList: readonly Tool[]): Promise<void> {
  const state = restore(store.read());
  if (!state) return;
  const tools = new Map(toolList.map((t) => [t.name, t]));
  for (const s of state.calls) await advance(store, state.batchId, s, tools);
}
