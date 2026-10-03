// 四种形态的全部词汇。pi 命令行只有三种 --mode（text / json / rpc），加上「不传参数、两头都是终端」的交互模式，
// 一共四种进程形态；SDK 不是进程形态，是把同一套会话运行时直接 import 进你的进程。

/** pi `main.ts` 里的 AppMode：一次启动最后落到哪一种 */
export type AppMode = "interactive" | "print" | "json" | "rpc";

/** 本书说的「四种形态」：三种进程形态（print 和 json 算一种）+ SDK */
export type Form = AppMode | "sdk";

/** 扩展在 `ctx.mode` 里看到的值（pi `core/extensions/types.ts:307`） */
export type ExtensionMode = "tui" | "rpc" | "json" | "print";

/** 会阻塞、要等回答的对话框；其余 UI 请求发出去就不管 */
export const DIALOG_METHODS = ["select", "confirm", "input", "editor"] as const;
export const NOTICE_METHODS = ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"] as const;
export type DialogMethod = (typeof DIALOG_METHODS)[number];

export type Severity = "error" | "warn" | "info";

export interface Finding {
  readonly severity: Severity;
  readonly rule: string;
  /** 第几行（从 1 开始）；和整份输出有关的发现没有行号 */
  readonly line?: number;
  readonly message: string;
}

/** 命令行参数、文件内容这类外部输入有问题；main.ts 接住后退出 2 */
export class InputError extends Error {}
