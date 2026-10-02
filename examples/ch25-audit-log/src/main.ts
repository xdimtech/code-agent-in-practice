import { makeAnchor, parseAnchor, serializeAnchor } from "./anchor.ts";
import { demo } from "./demo.ts";
import { keyFromEnv } from "./key.ts";
import { MAX_ANCHOR_BYTES, MAX_LOG_BYTES, MAX_SESSION_BYTES, readRegular } from "./load.ts";
import { printFacts, printFindings, printVerification } from "./report.ts";
import { inspectSession } from "./session-check.ts";
import { InputError } from "./types.ts";
import { passed, verifyLog } from "./verify.ts";

const USAGE = `用法：
  npm start                                     演示
  npm start -- verify <审计日志> [--anchor <锚点.json>]    密钥从环境变量 AUDIT_LOG_HMAC_KEY 读
  npm start -- anchor <审计日志>                 校验通过后打印链尾锚点，存到日志之外
  npm start -- session <pi 会话.jsonl>           列出这份会话能证明什么、不能证明什么`;

function option(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new InputError(`${name} 后面要跟一个值`);
  return value;
}

function positional(args: readonly string[]): string {
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--anchor");
  if (!file) throw new InputError(USAGE);
  return file;
}

function verify(args: readonly string[]): number {
  const anchorFile = option(args, "--anchor");
  const anchor = anchorFile ? parseAnchor(readRegular(anchorFile, MAX_ANCHOR_BYTES), anchorFile) : undefined;
  const key = keyFromEnv(process.env);
  const v = verifyLog(readRegular(positional(args), MAX_LOG_BYTES), { ...(key ? { key } : {}), ...(anchor ? { anchor } : {}) });
  printVerification(v);
  return passed(v) ? 0 : 1;
}

function anchor(args: readonly string[]): number {
  const key = keyFromEnv(process.env);
  const v = verifyLog(readRegular(positional(args), MAX_LOG_BYTES), key ? { key } : {});
  if (!passed(v) || !v.head) {
    printVerification(v);
    console.error("错误：日志校验不过或为空，不出锚点");
    return 1;
  }
  process.stdout.write(serializeAnchor(makeAnchor(v.head, new Date().toISOString())));
  return 0;
}

function session(args: readonly string[]): number {
  const { facts, findings } = inspectSession(readRegular(positional(args), MAX_SESSION_BYTES));
  printFacts(facts);
  printFindings(findings, 40);
  return findings.some((f) => f.severity === "error") ? 1 : 0;
}

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => number>> = { verify, anchor, session };

function main(args: readonly string[]): number {
  if (args.length === 0) {
    demo();
    return 0;
  }
  const command = COMMANDS[args[0]];
  if (!command) throw new InputError(USAGE);
  return command(args.slice(1));
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof InputError) {
    console.error(`错误：${error.message}`);
    process.exit(2);
  }
  throw error;
}
