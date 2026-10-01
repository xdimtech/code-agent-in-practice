// 第 26 章的最小循环：对应 pi 的 L1（agent-loop.ts runLoop）。
//
// 五条约定：
//   1. 只依赖「调模型」和「跑工具」两个抽象，其余全部通过回调注入；
//   2. 两层循环：内层「这一轮还没干完」，外层「有新的一件事」；
//   3. 错误是消息，不是异常；
//   4. 循环只改自己手里的快照；
//   5. 每轮结束后问一次「要不要停」。

export type Role = "user" | "assistant" | "tool";

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface Message {
  readonly role: Role;
  readonly text: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolCallId?: string;
  readonly stopReason?: "stop" | "toolUse" | "error";
}

export interface Tool {
  readonly name: string;
  execute(args: Readonly<Record<string, unknown>>): Promise<string>;
}

export type LoopEvent =
  | { readonly type: "turn_start" }
  | { readonly type: "message"; readonly message: Message }
  | { readonly type: "turn_end"; readonly message: Message }
  | { readonly type: "agent_end"; readonly messages: readonly Message[] };

export interface LoopConfig {
  readonly callModel: (messages: readonly Message[]) => Promise<Message>;
  readonly tools: readonly Tool[];
  readonly getSteering?: () => Message[];
  readonly getFollowUp?: () => Message[];
  readonly shouldStopAfterTurn?: (turn: { message: Message; turnIndex: number }) => boolean;
}

/** 模型调用失败时返回一条 error 消息，而不是抛出去（约定 3） */
async function safeCallModel(config: LoopConfig, messages: readonly Message[]): Promise<Message> {
  try {
    return await config.callModel(messages);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { role: "assistant", text, stopReason: "error" };
  }
}

async function runTool(tools: readonly Tool[], call: ToolCall): Promise<Message> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    return { role: "tool", toolCallId: call.id, text: `未知工具：${call.name}`, stopReason: "error" };
  }
  try {
    return { role: "tool", toolCallId: call.id, text: await tool.execute(call.args) };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { role: "tool", toolCallId: call.id, text, stopReason: "error" };
  }
}

export async function runLoop(
  snapshot: readonly Message[],
  config: LoopConfig,
  emit: (event: LoopEvent) => void,
): Promise<readonly Message[]> {
  // 约定 4：只在本地数组上追加，调用者传进来的快照不被改动
  let context: readonly Message[] = [...snapshot];
  const produced: Message[] = [];
  const append = (m: Message): void => {
    context = [...context, m];
    produced.push(m);
    emit({ type: "message", message: m });
  };

  let pending = config.getSteering?.() ?? [];
  let turnIndex = 0;

  while (true) {
    let hasMoreToolCalls = true;
    while (hasMoreToolCalls || pending.length > 0) {
      emit({ type: "turn_start" });
      for (const m of pending) append(m);
      pending = [];

      const reply = await safeCallModel(config, context);
      append(reply);
      if (reply.stopReason === "error") {
        emit({ type: "turn_end", message: reply });
        emit({ type: "agent_end", messages: produced }); // 出口①
        return produced;
      }

      const calls = reply.toolCalls ?? [];
      for (const call of calls) append(await runTool(config.tools, call));
      hasMoreToolCalls = calls.length > 0;
      emit({ type: "turn_end", message: reply });

      turnIndex += 1;
      if (config.shouldStopAfterTurn?.({ message: reply, turnIndex })) {
        emit({ type: "agent_end", messages: produced }); // 出口②
        return produced;
      }
      pending = config.getSteering?.() ?? [];
    }

    const followUp = config.getFollowUp?.() ?? [];
    if (followUp.length > 0) {
      pending = followUp;
      continue;
    }
    break; // 出口③
  }

  emit({ type: "agent_end", messages: produced });
  return produced;
}
