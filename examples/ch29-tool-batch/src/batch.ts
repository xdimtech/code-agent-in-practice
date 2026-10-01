// 第 29 章的工具批次执行：对应 pi 的 executeToolCalls（agent-loop.ts:409-560）。
//
// 四条约定：
//   1. 准备（查找、校验、beforeCall）按调用顺序串行；执行并发；
//   2. 进度事件按完成顺序发，结果按调用顺序落盘；
//   3. 任何失败都变成一条 isError 的结果，批次里每个调用都有且只有一条结果；
//   4. 批次提前终止要全票。

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ToolOutput {
  readonly text: string;
  readonly terminate?: boolean;
}

export interface ToolResult extends ToolOutput {
  readonly toolCallId: string;
  readonly isError: boolean;
}

export interface Tool {
  readonly name: string;
  /** 为 true 时整批退回串行（与 pi 的 executionMode: "sequential" 相同的粒度） */
  readonly sequential?: boolean;
  execute(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ToolOutput>;
}

export type BatchEvent =
  | { readonly type: "start"; readonly toolCallId: string }
  | { readonly type: "end"; readonly toolCallId: string; readonly isError: boolean };

export interface BeforeCallVerdict {
  readonly block: true;
  readonly reason: string;
  readonly terminate?: boolean;
}

export interface BatchOptions {
  readonly signal?: AbortSignal;
  readonly beforeCall?: (call: ToolCall) => Promise<BeforeCallVerdict | undefined>;
  readonly emit?: (event: BatchEvent) => void;
}

export interface BatchOutcome {
  readonly results: readonly ToolResult[];
  readonly terminate: boolean;
}

export const SKIPPED_REASON = "已中止：工具未执行";

const failed = (call: ToolCall, text: string, terminate?: boolean): ToolResult => ({
  toolCallId: call.id,
  text,
  isError: true,
  ...(terminate ? { terminate } : {}),
});

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type Prepared = { readonly kind: "run"; readonly call: ToolCall; readonly tool: Tool } | { readonly kind: "done"; readonly result: ToolResult };

/** 约定 1、3：准备阶段的每一种失败都直接产出结果，而不是抛出 */
async function prepare(call: ToolCall, tools: readonly Tool[], options: BatchOptions): Promise<Prepared> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { kind: "done", result: failed(call, `未知工具：${call.name}`) };
  try {
    const verdict = await options.beforeCall?.(call);
    if (options.signal?.aborted) return { kind: "done", result: failed(call, SKIPPED_REASON) };
    if (verdict?.block) return { kind: "done", result: failed(call, verdict.reason, verdict.terminate) };
    return { kind: "run", call, tool };
  } catch (err) {
    return { kind: "done", result: failed(call, message(err)) };
  }
}

async function execute(prepared: Prepared, signal: AbortSignal): Promise<ToolResult> {
  if (prepared.kind === "done") return prepared.result;
  const { call, tool } = prepared;
  if (signal.aborted) return failed(call, SKIPPED_REASON);
  try {
    const output = await tool.execute(call.args, signal);
    return { toolCallId: call.id, isError: false, ...output };
  } catch (err) {
    return failed(call, message(err));
  }
}

type Finish = (prepared: Prepared) => Promise<ToolResult>;
type PrepareNext = (call: ToolCall) => Promise<Prepared>;

/** 串行：准备一个、执行一个 */
async function runSequential(calls: readonly ToolCall[], prepareNext: PrepareNext, finish: Finish): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of calls) results.push(await finish(await prepareNext(call)));
  return results;
}

/** 并行：先按顺序全部准备完，再一起执行（与 pi 相同；deepseek-harness 选择准备完一个就派发一个） */
async function runParallel(calls: readonly ToolCall[], prepareNext: PrepareNext, finish: Finish): Promise<ToolResult[]> {
  const prepared: Prepared[] = [];
  for (const call of calls) prepared.push(await prepareNext(call));
  // Promise.all 按数组下标返回：结果按调用顺序落盘，与谁先完成无关（约定 2）
  return Promise.all(prepared.map(finish));
}

export async function runBatch(calls: readonly ToolCall[], tools: readonly Tool[], options: BatchOptions = {}): Promise<BatchOutcome> {
  const signal = options.signal ?? new AbortController().signal;
  const emit = options.emit ?? ((): void => {});

  const prepareNext: PrepareNext = async (call) => {
    emit({ type: "start", toolCallId: call.id });
    // 约定 3：中止之后剩下的调用也要有结果——在写入时补齐（pi 选择在回放时补）
    if (signal.aborted) return { kind: "done", result: failed(call, SKIPPED_REASON) };
    return prepare(call, tools, options);
  };
  const finish: Finish = async (prepared) => {
    const result = await execute(prepared, signal);
    emit({ type: "end", toolCallId: result.toolCallId, isError: result.isError }); // 约定 2：完成顺序
    return result;
  };

  const sequential = calls.some((c) => tools.find((t) => t.name === c.name)?.sequential === true);
  const results = await (sequential ? runSequential : runParallel)(calls, prepareNext, finish);
  const terminate = results.length > 0 && results.every((r) => r.terminate === true); // 约定 4
  return { results, terminate };
}
