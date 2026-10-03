import type { AppMode, ExtensionMode, Form } from "./types.ts";

// 一次启动落到哪种形态，以及每种形态对接入方许下的契约。
// resolveAppMode 照抄 pi `main.ts:110-121` 的判断顺序；PROFILES 每一格都对应正文里一处 file:line。

export interface LaunchArgs {
  /** `--mode` 的值；pi 只认 text / json / rpc（`cli/args.ts:11`） */
  readonly mode?: "text" | "json" | "rpc";
  /** `-p` / `--print` */
  readonly print?: boolean;
}

export interface Tty {
  readonly stdin: boolean;
  readonly stdout: boolean;
}

/** rpc 和 json 由参数决定；剩下的只要有一头不是终端就退成 print */
export function resolveAppMode(args: LaunchArgs, tty: Tty): AppMode {
  if (args.mode === "rpc") return "rpc";
  if (args.mode === "json") return "json";
  if (args.print || !tty.stdin || !tty.stdout) return "print";
  return "interactive";
}

/** 契约的各个维度。换形态时，每一个不同的维度都是一处要重写的接入代码 */
export interface Profile {
  readonly lifetime: string;
  readonly input: string;
  readonly output: string;
  readonly failure: string;
  readonly extensionMode: ExtensionMode;
  readonly hasUI: boolean;
  readonly dialogs: string;
  readonly trust: string;
  readonly isolation: string;
}

export const DIMENSIONS: Readonly<Record<keyof Profile, string>> = {
  lifetime: "进程生命周期",
  input: "输入",
  output: "输出",
  failure: "失败怎么报",
  extensionMode: "扩展看到的 ctx.mode",
  hasUI: "扩展看到的 ctx.hasUI",
  dialogs: "扩展弹对话框时",
  trust: "项目信任",
  isolation: "隔离与语言",
};

const PIPED = "参数 + 管道 stdin（读到 EOF 才开始）";
const NO_PROMPT_TRUST = "不弹信任提示，按 defaultProjectTrust（默认忽略项目资源）";
const CHILD = "子进程；接入方用什么语言都行";

export const PROFILES: Readonly<Record<Form, Profile>> = {
  interactive: {
    lifetime: "常驻，人坐在终端前",
    input: "键盘",
    output: "终端界面",
    failure: "界面里提示，进程不退",
    extensionMode: "tui",
    hasUI: true,
    dialogs: "终端里弹出，等人选",
    trust: "第一次进项目时弹提示",
    isolation: "独占一个终端",
  },
  print: {
    lifetime: "一次一问，跑完退出",
    input: PIPED,
    output: "只有最后一条助手消息的文本",
    failure: "最后一条出错或被中止退 1；SIGTERM 143、SIGHUP 129",
    extensionMode: "print",
    hasUI: false,
    dialogs: "不弹，直接拿默认值（confirm 为 false）",
    trust: NO_PROMPT_TRUST,
    isolation: CHILD,
  },
  json: {
    lifetime: "一次一问，跑完退出",
    input: PIPED,
    output: "会话头 + 全部事件，一行一个 JSON",
    failure: "最后一条出错也退 0，要自己从事件里读；抛异常才退 1",
    extensionMode: "json",
    hasUI: false,
    dialogs: "不弹，直接拿默认值（confirm 为 false）",
    trust: NO_PROMPT_TRUST,
    isolation: CHILD,
  },
  rpc: {
    lifetime: "常驻，stdin 关掉才退",
    input: "stdin 上一行一条 JSON 命令",
    output: "响应 + 事件 + 扩展 UI 请求，混在一条 stdout 里",
    failure: "每条命令一个 success / error 响应；prompt 的响应要等预检过了才发",
    extensionMode: "rpc",
    hasUI: true,
    dialogs: "变成 extension_ui_request，没有超时就一直等你回",
    trust: NO_PROMPT_TRUST,
    isolation: CHILD,
  },
  sdk: {
    lifetime: "跟着你的进程",
    input: "函数调用",
    output: "没有；你订阅事件",
    failure: "抛异常；会话崩了宿主一起崩",
    extensionMode: "print",
    hasUI: false,
    dialogs: "拿默认值，除非你 bindExtensions 时给 uiContext",
    trust: "你自己给 ResourceLoader 决定加载什么",
    isolation: "同一个进程、同一份 process.env；只能是 Node / TypeScript",
  },
};

export interface Change {
  readonly dimension: string;
  readonly from: string;
  readonly to: string;
}

/** 从一种形态换到另一种：列出每个契约维度上的变化。列出来的每一行，接入方都要改代码 */
export function switchCost(from: Form, to: Form): readonly Change[] {
  const a = PROFILES[from];
  const b = PROFILES[to];
  return (Object.keys(DIMENSIONS) as (keyof Profile)[])
    .filter((k) => a[k] !== b[k])
    .map((k) => ({ dimension: DIMENSIONS[k], from: String(a[k]), to: String(b[k]) }));
}

/** 没有 UI 时对话框的返回值（pi `core/extensions/runner.ts:236-255` 的 noOpUIContext） */
export function noUiAnswer(method: "select" | "confirm" | "input" | "editor"): string | boolean | undefined {
  return method === "confirm" ? false : undefined;
}
