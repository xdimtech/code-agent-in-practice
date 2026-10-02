// 命令分析给三种结果，不是两种。
//   matched    —— 命中了一条已知的危险规则
//   unresolved —— 看不全：有一部分要到运行时才知道跑的是什么
//   ordinary   —— 没有规则命中。这不等于安全，只等于「静态规则没话说」
// 把 unresolved 并进 ordinary，就是把「不知道」当成了「没问题」。

import { parseShell, type SimpleCommand } from "./shell.ts";

export type Analysis =
  | { readonly kind: "matched"; readonly rule: string }
  | { readonly kind: "unresolved"; readonly why: string }
  | { readonly kind: "ordinary" };

export interface CommandReport {
  readonly analysis: Analysis;
  /** 所有输出重定向的目标，交给路径规则去查 */
  readonly redirects: readonly string[];
}

/** 这些词后面跟的才是真正的命令，剥掉再看 */
const PEEL = new Set(["{", "!", "if", "then", "else", "elif", "do", "while", "until", "time", "nohup", "command", "exec", "builtin", "env"]);
/** 这些命令会去跑别的命令，跑什么要看参数怎么拼，不猜 */
const WRAPPERS = new Set(["xargs", "nice", "timeout", "watch", "eval", "source", ".", "parallel", "ssh"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const INLINE_CODE: Readonly<Record<string, readonly string[]>> = {
  python: ["-c"],
  python3: ["-c"],
  node: ["-e", "--eval", "-p"],
  perl: ["-e"],
  ruby: ["-e"],
  php: ["-r"],
};
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** 命令名里有变量、通配或花括号展开：要 shell 展开之后才知道是哪个程序 */
const DYNAMIC_NAME = /[$*?]|\{.*,/;

interface Rule {
  readonly id: string;
  readonly test: (name: string, args: readonly string[], command: SimpleCommand) => boolean;
}

const shortFlags = (args: readonly string[]): string => args.filter((a) => /^-[A-Za-z]+$/.test(a)).join("");

const RULES: readonly Rule[] = [
  { id: "privilege", test: (name) => ["sudo", "doas", "su", "pkexec"].includes(name) },
  { id: "recursive-delete", test: (name, args) => name === "rm" && (args.includes("--recursive") || /[rR]/.test(shortFlags(args))) },
  { id: "find-delete", test: (name, args) => name === "find" && args.includes("-delete") },
  {
    id: "world-writable",
    test: (name, args) => name === "chmod" && args.some((a) => /^[0-7]?[0-7]{2}[2367]$/.test(a) || /^[ugoa]*[oa][ugoa]*\+[rxXst]*w/.test(a)),
  },
  {
    id: "git-destructive",
    test: (name, args) =>
      name === "git" &&
      ((args.includes("reset") && args.includes("--hard")) ||
        (args.includes("clean") && /f/.test(shortFlags(args))) ||
        (args.includes("push") && args.some((a) => a === "-f" || a.startsWith("--force")))),
  },
  { id: "pipe-to-shell", test: (name, args, command) => command.piped && SHELLS.has(name) && args.every((a) => a.startsWith("-")) },
];

function peel(argv: readonly string[]): readonly string[] {
  let i = 0;
  while (i < argv.length && (PEEL.has(argv[i]!) || ASSIGNMENT.test(argv[i]!))) i += 1;
  return argv.slice(i);
}

function classify(command: SimpleCommand): Analysis {
  const [first, ...args] = peel(command.argv);
  if (first === undefined) return { kind: "ordinary" };
  if (first.startsWith("-")) return { kind: "unresolved", why: "包装命令带了选项" };
  if (DYNAMIC_NAME.test(first)) return { kind: "unresolved", why: "命令名要展开才知道" };
  // 取路径最后一段并转小写：/bin/rm 和 rm 是一回事；大小写不敏感的文件系统上 RM 也是
  const name = first.split("/").at(-1)!.toLowerCase();
  const rule = RULES.find((r) => r.test(name, args, command));
  if (rule) return { kind: "matched", rule: rule.id };
  if (WRAPPERS.has(name)) return { kind: "unresolved", why: `${name} 会去跑别的命令` };
  if (name === "find" && args.some((a) => ["-exec", "-execdir", "-ok"].includes(a))) return { kind: "unresolved", why: "find -exec 会去跑别的命令" };
  if (SHELLS.has(name) && args.includes("-c")) return { kind: "unresolved", why: `${name} -c 里的脚本没有拆` };
  if (INLINE_CODE[name]?.some((flag) => args.includes(flag))) return { kind: "unresolved", why: `${name} 的内联代码不是 shell` };
  return { kind: "ordinary" };
}

export function analyzeCommand(script: string): CommandReport {
  const parsed = parseShell(script);
  const results = parsed.commands.map(classify);
  const redirects = parsed.commands.flatMap((c) => c.redirects);
  // 命中优先于看不全：rm -rf $(pwd) 虽然没拆完，已经看到的部分足够下结论
  const matched = results.find((r) => r.kind === "matched");
  if (matched) return { analysis: matched, redirects };
  if (parsed.unresolved) return { analysis: { kind: "unresolved", why: parsed.unresolved }, redirects };
  return { analysis: results.find((r) => r.kind === "unresolved") ?? { kind: "ordinary" }, redirects };
}
