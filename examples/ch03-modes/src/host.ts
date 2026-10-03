import { serializeLine } from "./jsonl.ts";
import { cancelReply, classify } from "./protocol.ts";

// 接入方（宿主）这一侧的 RPC 状态机：纯函数，进来一行、出去零到多行、换一个新状态。
// 真正的进程读写在 client.ts；这里只管「这一行意味着什么、要不要回话」。

/**
 * 子进程弹对话框时宿主怎么办：
 * - cancel：立刻回「取消」。Step-Code 的子 agent 就这么做，因为后面没有人能回答
 * - ignore：不回。pi 自带的 RpcClient 没有回 UI 请求的方法，相当于这一种
 */
export type DialogPolicy = "cancel" | "ignore";

export interface OpenDialog {
  readonly id: string;
  readonly method: string;
  readonly timeout?: number;
}

export interface HostState {
  readonly nextId: number;
  /** 已发出、还没收到响应的命令：id → 命令类型 */
  readonly pending: ReadonlyMap<string, string>;
  /** 收到了、没有回答的对话框 */
  readonly dialogs: readonly OpenDialog[];
  /** 见过几次 agent_settled（这一轮连同排队的消息全部跑完） */
  readonly settled: number;
  readonly problems: readonly string[];
}

export const initialHost = (): HostState => ({ nextId: 1, pending: new Map(), dialogs: [], settled: 0, problems: [] });

export interface Command {
  readonly type: string;
  readonly [field: string]: unknown;
}

/** 每条命令都带 id；响应里会带回同一个 id（docs/rpc.md:26） */
export function send(state: HostState, command: Command): { state: HostState; line: string } {
  const id = `req_${state.nextId}`;
  return {
    state: { ...state, nextId: state.nextId + 1, pending: new Map([...state.pending, [id, command.type]]) },
    line: serializeLine({ ...command, id }),
  };
}

export interface Step {
  readonly state: HostState;
  readonly out: readonly string[];
}

const withProblem = (state: HostState, problem: string): Step => ({ state: { ...state, problems: [...state.problems, problem] }, out: [] });

export function receive(state: HostState, line: string, policy: DialogPolicy): Step {
  const msg = classify(line);
  switch (msg.kind) {
    case "bad":
      return withProblem(state, msg.reason);
    case "response": {
      if (msg.id === undefined || !state.pending.has(msg.id)) {
        return withProblem(state, `对不上请求的响应（${msg.command}）：${msg.error ?? "成功"}`);
      }
      const pending = new Map([...state.pending].filter(([id]) => id !== msg.id));
      const next = { ...state, pending };
      return msg.success ? { state: next, out: [] } : withProblem(next, `${msg.command} 失败：${msg.error ?? "未说明原因"}`);
    }
    case "dialog": {
      if (policy === "cancel") return { state, out: [serializeLine(cancelReply(msg.id))] };
      const open: OpenDialog = { id: msg.id, method: msg.method, ...(msg.timeout ? { timeout: msg.timeout } : {}) };
      return { state: { ...state, dialogs: [...state.dialogs, open] }, out: [] };
    }
    case "notice":
      return { state, out: [] };
    case "event":
      return msg.type === "agent_settled" ? { state: { ...state, settled: state.settled + 1 }, out: [] } : { state, out: [] };
  }
}

/** 没人回答、也没有超时的对话框：子进程会一直等下去（pi `modes/rpc/rpc-mode.ts:115-120` 只在给了 timeout 时才设定时器） */
export const stuckDialogs = (state: HostState): readonly OpenDialog[] => state.dialogs.filter((d) => d.timeout === undefined);
