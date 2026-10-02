// 把一行 shell 拆成简单命令。只做到「够用来判断」的程度：认引号、转义、分隔符、管道、重定向；
// 遇到要运行时才知道结果的写法（命令替换、进程替换、here-doc）就停下来说「看不全」，不猜。
// 这是词法层面的近似，不是 bash 语法的实现；它的用处是让规则比对的是词，不是整行字符串。

export interface SimpleCommand {
  /** 去掉引号后的词，[0] 是命令名 */
  readonly argv: readonly string[];
  /** 输出重定向（> >> &>）的目标文件 */
  readonly redirects: readonly string[];
  /** 标准输入是否来自上一条命令的管道 */
  readonly piped: boolean;
}

export interface ParsedShell {
  readonly commands: readonly SimpleCommand[];
  /** 有这一项说明没拆完；commands 里是停下来之前已经看到的部分 */
  readonly unresolved?: string;
}

interface Builder {
  commands: SimpleCommand[];
  argv: string[];
  redirects: string[];
  word: string | undefined;
  expect: "arg" | "redirect" | "input";
  piped: boolean;
  unresolved: string | undefined;
}

const SEPARATORS = new Set([";", "\n", "(", ")"]);

function endWord(b: Builder): void {
  if (b.word === undefined) return;
  if (b.expect === "redirect") b.redirects.push(b.word);
  else if (b.expect === "arg") b.argv.push(b.word);
  b.word = undefined;
  b.expect = "arg";
}

function endCommand(b: Builder, nextPiped: boolean): void {
  endWord(b);
  if (b.argv.length > 0 || b.redirects.length > 0) b.commands.push({ argv: b.argv, redirects: b.redirects, piped: b.piped });
  b.argv = [];
  b.redirects = [];
  b.piped = nextPiped;
  b.expect = "arg";
}

function fail(b: Builder, why: string, end: number): number {
  b.unresolved = why;
  return end;
}

function quoted(s: string, i: number, b: Builder): number {
  const quote = s[i]!;
  let text = "";
  let j = i + 1;
  while (j < s.length && s[j] !== quote) {
    if (quote === '"' && s[j] === "\\" && j + 1 < s.length) {
      text += s[j + 1];
      j += 2;
      continue;
    }
    if (quote === '"' && (s[j] === "`" || (s[j] === "$" && s[j + 1] === "("))) return fail(b, "命令替换", s.length);
    text += s[j];
    j += 1;
  }
  if (j >= s.length) return fail(b, "引号没闭合", s.length);
  b.word = (b.word ?? "") + text;
  return j + 1;
}

function redirect(s: string, i: number, b: Builder): number {
  let j = s[i] === "&" ? i + 1 : i; // &> 把两路输出都写进文件
  const input = s[j] === "<";
  if (input && s[j + 1] === "<") return fail(b, "here-doc", s.length);
  if (b.word !== undefined && /^\d+$/.test(b.word)) b.word = undefined; // 2> 里的 2 是文件描述符，不是参数
  endWord(b);
  j += 1;
  if (s[j] === ">") j += 1; // >>
  if (s[j] === "|") j += 1; // >|
  if (s[j] === "&") {
    j += 1; // 2>&1 只是复制描述符，没有目标文件
    while (j < s.length && /[\d-]/.test(s[j]!)) j += 1;
    return j;
  }
  b.expect = input ? "input" : "redirect";
  return j;
}

function operator(s: string, i: number, b: Builder): number {
  const c = s[i]!;
  const two = s.slice(i, i + 2);
  if (two === "&&" || two === "||") {
    endCommand(b, false);
    return i + 2;
  }
  if (c === "|") {
    endCommand(b, true);
    return s[i + 1] === "&" ? i + 2 : i + 1;
  }
  if (c === "&" || SEPARATORS.has(c)) {
    endCommand(b, false);
    return i + 1;
  }
  b.word = (b.word ?? "") + c;
  return i + 1;
}

function step(s: string, i: number, b: Builder): number {
  const c = s[i]!;
  const next = s[i + 1];
  if (c === "\\") {
    b.word = (b.word ?? "") + (next ?? "");
    return i + 2;
  }
  if (c === "'" || c === '"') return quoted(s, i, b);
  if (c === "`" || (c === "$" && next === "(")) return fail(b, "命令替换", s.length);
  if ((c === "<" || c === ">") && next === "(") return fail(b, "进程替换", s.length);
  if (c === " " || c === "\t") {
    endWord(b);
    return i + 1;
  }
  if (c === "#" && b.word === undefined) {
    const newline = s.indexOf("\n", i);
    return newline < 0 ? s.length : newline;
  }
  if (c === ">" || c === "<" || (c === "&" && next === ">")) return redirect(s, i, b);
  return operator(s, i, b);
}

export function parseShell(script: string): ParsedShell {
  const b: Builder = { commands: [], argv: [], redirects: [], word: undefined, expect: "arg", piped: false, unresolved: undefined };
  let i = 0;
  while (i < script.length && b.unresolved === undefined) i = step(script, i, b);
  endCommand(b, false);
  return b.unresolved === undefined ? { commands: b.commands } : { commands: b.commands, unresolved: b.unresolved };
}
