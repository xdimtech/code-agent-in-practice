// pi 没有日志级别，也没有 PI_DEBUG；能打开的调试输出是七个散在各处的环境变量。
// 它们都不在环境变量参考（docs/environment-variables.md:79-95）和 --help（cli/args.ts:430-435）里，
// 而且「怎样算打开」各写各的：有的只认 "1"，有的认 1/true/yes，有的非空就算。

export type Activation = "等于 1" | "1/true/yes" | "非空";

export interface DebugVar {
  readonly name: string;
  readonly activation: Activation;
  readonly purpose: string;
  /** 写到哪里 */
  readonly sink: string;
  /** 会不会把屏幕内容、对话或文件内容落盘 */
  readonly capturesContent: boolean;
  /** pi 的出处，packages/ 下的相对路径 */
  readonly source: string;
}

export const DEBUG_VARS: readonly DebugVar[] = [
  { name: "PI_TIMING", activation: "等于 1", purpose: "启动各阶段耗时", sink: "stderr", capturesContent: false, source: "coding-agent/src/core/timings.ts:6、:34-50" },
  { name: "PI_STARTUP_BENCHMARK", activation: "1/true/yes", purpose: "只初始化交互界面、打印耗时后退出；非交互模式直接报错", sink: "stderr", capturesContent: false, source: "coding-agent/src/main.ts:105-108、:911-915、:943-958" },
  { name: "PI_TUI_DEBUG", activation: "等于 1", purpose: "每一帧差分渲染的内部状态与前后两帧全文", sink: "/tmp/tui/render-<时间>-<随机>.log，每帧一个文件", capturesContent: true, source: "tui/src/tui-main-screen.ts:568-590" },
  { name: "PI_DEBUG_REDRAW", activation: "等于 1", purpose: "每次全量重绘的原因", sink: "<agentDir>/pi-debug.log（追加）", capturesContent: false, source: "tui/src/tui-main-screen.ts:320-327" },
  { name: "PI_TUI_WRITE_LOG", activation: "非空", purpose: "写往终端的原始 ANSI 字节流", sink: "给目录则写 tui-<时间>-<pid>.log，否则当文件路径；追加，写失败静默", capturesContent: true, source: "tui/src/terminal.ts:138-151、:476-483" },
  { name: "PI_EXPERIMENTAL", activation: "等于 1", purpose: "打开实验特性：会改变发给模型的工具采样参数", sink: "（不输出，改行为）", capturesContent: false, source: "coding-agent/src/core/experimental.ts:3-9" },
  { name: "PI_EVAL_ARTIFACT_DIR", activation: "非空", purpose: "评测框架落盘每次运行的报告，只在 evals 包里有效", sink: "指定目录", capturesContent: true, source: "evals/src/vitest-evals/reporter.ts:14-16" },
];

export function isActive(activation: Activation, value: string | undefined): boolean {
  if (value === undefined) return false;
  if (activation === "等于 1") return value === "1";
  if (activation === "1/true/yes") return ["1", "true", "yes"].includes(value.toLowerCase());
  return value.trim() !== "";
}

export interface EnvCheck {
  readonly name: string;
  readonly value: string;
  readonly active: boolean;
  readonly notes: readonly string[];
}

function notesFor(v: DebugVar, value: string, active: boolean): string[] {
  if (!active) return [`设成了 ${JSON.stringify(value)}，但这个变量只在「${v.activation}」时生效`];
  const notes: string[] = [];
  if (v.capturesContent) notes.push(`会把内容落盘：${v.sink}；用完记得删`);
  if (v.name === "PI_DEBUG_REDRAW") notes.push("和 /debug 写同一个文件，按一次 /debug 就把之前的重绘记录覆盖了");
  if (v.name === "PI_TUI_DEBUG") notes.push("每帧一个文件，开一会儿就是成百上千个");
  if (v.name === "PI_EXPERIMENTAL") notes.push("这个不是调试输出，它改变行为：复现问题时两边要设成一样");
  return notes;
}

/** 只看列表里的七个变量，不读、不回显其他环境变量 */
export function checkEnv(env: Readonly<Record<string, string | undefined>>): EnvCheck[] {
  return DEBUG_VARS.flatMap((v) => {
    const value = env[v.name];
    if (value === undefined) return [];
    const active = isActive(v.activation, value);
    return [{ name: v.name, value, active, notes: notesFor(v, value, active) }];
  });
}

/** 日志目录：PI_CODING_AGENT_DIR，缺省 ~/.pi/agent（tui/src/tui.ts:366、coding-agent/src/config.ts:573-575） */
export function agentDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const dir = env.PI_CODING_AGENT_DIR;
  if (!dir) return `${home}/.pi/agent`;
  return dir === "~" ? home : dir.startsWith("~/") ? `${home}${dir.slice(1)}` : dir; // pi 也展开 ~（config.ts:524-530）
}
