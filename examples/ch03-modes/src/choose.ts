import type { Form } from "./types.ts";

// 按产品形态选一种接法。规则只有四条，顺序就是图 3-4 的判断顺序；每条都带上它的代价。

export interface Needs {
  /** 谁在看：人在 pi 自己的终端界面里 / 人在你做的界面里 / 没有人（CI、批处理、子 agent） */
  readonly viewer: "pi-terminal" | "own-ui" | "nobody";
  /** 你的宿主代码：Node / TypeScript 进程，能直接 import / 别的语言或想要进程隔离 */
  readonly host: "node" | "other";
  /** 一次问完就结束，还是要来回多轮、中途插话、换会话 */
  readonly turns: "one" | "many";
  /** 要不要看到中间过程（工具调用、流式文本），还是只要最后的答案 */
  readonly events: boolean;
}

export interface Choice {
  readonly form: Form;
  readonly why: string;
  readonly costs: readonly string[];
}

export function choose(n: Needs): Choice {
  if (n.viewer === "pi-terminal") {
    return { form: "interactive", why: "人就坐在终端前，用 pi 自己的界面", costs: ["界面不归你：要改样子只能写扩展或 fork interactive 那 18,302 行"] };
  }
  if (n.host === "node" && n.viewer === "own-ui") {
    return {
      form: "sdk",
      why: "宿主是 Node，又要自己画界面：直接 import，事件是对象而不是字符串",
      costs: [
        "和宿主同一个进程：同一份 process.env、同一个 cwd，会话崩了宿主一起崩",
        "扩展默认看到 mode=print、hasUI=false；要对话框得自己 bindExtensions 给 uiContext",
        "换会话要用 AgentSessionRuntime，换完重新订阅、重新 bindExtensions",
      ],
    };
  }
  if (n.turns === "one") {
    return n.events
      ? { form: "json", why: "一次一问，但要看过程：一行一个事件", costs: ["最后一条出错也退 0，成败要从 agent_end 里读", "stdin 是管道就会读到 EOF 才开始，调用方记得关掉它或设成 ignore"] }
      : { form: "print", why: "一次一问，只要答案：最简单的管道", costs: ["只有最后一条助手消息的文本，看不到工具调用", "扩展的对话框直接拿默认值，确认类一律是「否」"] };
  }
  return {
    form: "rpc",
    why: "多轮、要中途插话或换会话、宿主不是 Node 或者要进程隔离",
    costs: [
      "要自己写严格的 JSONL 分帧，不能用通用分行器",
      "响应、事件、UI 请求混在一条流里，要按 id 对",
      "扩展的对话框要你回；不回又没有超时，子进程就一直等",
    ],
  };
}
