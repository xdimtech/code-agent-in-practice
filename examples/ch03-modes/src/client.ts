import { spawn } from "node:child_process";
import { createLineReader, MAX_LINE_BYTES, type Splitter, takeLines } from "./jsonl.ts";
import { type Command, type DialogPolicy, type HostState, initialHost, receive, send, stuckDialogs } from "./host.ts";

// 薄薄的一层 I/O：起一个 RPC 子进程，把 stdout 喂给 host.ts 的状态机，把要回的话写回 stdin。
// 发一轮 prompt，等到 agent_settled 或超时为止。

export interface RunOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly policy: DialogPolicy;
  readonly timeoutMs: number;
  /** 默认是严格分帧；演示时换成通用分行器，看它在哪里切错 */
  readonly split?: Splitter;
  readonly env?: Readonly<Record<string, string>>;
}

export interface TurnResult {
  readonly outcome: "settled" | "timeout" | "exited" | "oversize";
  readonly state: HostState;
  readonly lines: readonly string[];
  readonly exitCode: number | null;
}

export function runTurn(prompt: Command, options: RunOptions): Promise<TurnResult> {
  const child = spawn(options.command, [...options.args], { stdio: ["pipe", "pipe", "inherit"], env: { PATH: process.env.PATH ?? "", ...options.env } });
  let state = initialHost();
  const lines: string[] = [];
  return new Promise((resolve) => {
    let done = false;
    const finish = (outcome: TurnResult["outcome"]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      if (outcome !== "exited") child.kill("SIGTERM");
      resolve({ outcome, state, lines, exitCode: child.exitCode });
    };
    const timer = setTimeout(() => finish("timeout"), options.timeoutMs);
    const reader = createLineReader(
      {
        onLine(line) {
          lines.push(line);
          const step = receive(state, line, options.policy);
          state = step.state;
          for (const out of step.out) child.stdin.write(out);
          if (state.settled > 0) finish("settled");
        },
        onOversize: () => finish("oversize"),
      },
      MAX_LINE_BYTES,
      options.split ?? takeLines,
    );
    child.stdout.on("data", (chunk: Buffer) => reader.push(chunk));
    child.on("exit", () => {
      reader.end();
      finish("exited");
    });
    const first = send(state, prompt);
    state = first.state;
    child.stdin.write(first.line);
  });
}

/** 一轮没收尾时，说清楚卡在哪 */
export function explain(result: TurnResult): string {
  if (result.outcome === "settled") return "这一轮跑完了（收到 agent_settled）";
  const stuck = stuckDialogs(result.state);
  if (result.outcome === "timeout" && stuck.length > 0) {
    return `超时：子进程在等 ${stuck.map((d) => `${d.method}(${d.id})`).join("、")} 的回答，对话框没有超时，宿主又没回`;
  }
  if (result.outcome === "oversize") return "一行超过上限还没等到换行，按协议错误杀掉了子进程";
  return result.outcome === "timeout" ? "超时，没有收到 agent_settled" : `子进程先退了（退出码 ${String(result.exitCode)}）`;
}
