import { homedir } from "node:os";
import { agentDir, checkEnv, DEBUG_VARS } from "./debug-vars.ts";
import { demo } from "./demo.ts";
import { diagnose, hasBlocking } from "./diagnose.ts";
import { hasFailure, runChecks } from "./doctor.ts";
import { parseSession, SessionFormatError } from "./jsonl.ts";
import { probe, readSessionFile, SessionFileError, writeSessionCopy } from "./load.ts";
import { redactEntries } from "./redact.ts";
import { costs, printChecks, printFindings, printTape, section, summarize } from "./report.ts";
import { exchanges, parseTape, TapeFormatError } from "./tape.ts";
import { tapeFindings } from "./tape-check.ts";
import { timeline } from "./timeline.ts";
import { buildTree } from "./tree.ts";

const USAGE = "用法：npm start -- <会话.jsonl> [--redact <输出.jsonl>] [--tape <磁带.jsonl>] ｜ --env ｜ --doctor";

/** 取 --name 后面的值；没给这个选项返回 undefined，给了但没有值就报错 */
function option(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new SessionFileError(`${name} 后面要跟文件路径`);
  return value;
}

function inspect(args: readonly string[]): number {
  const redactTo = option(args, "--redact");
  const tapeFile = option(args, "--tape");
  const file = args.find((a, i) => !a.startsWith("--") && !["--redact", "--tape"].includes(args[i - 1] ?? ""));
  if (!file) throw new SessionFileError(USAGE);
  const parsed = parseSession(readSessionFile(file));
  const tree = buildTree(parsed.entries);
  summarize(parsed, tree);
  section("时间线");
  for (const line of timeline(tree.activePath, { inContext: new Set(tree.context.map((e) => e.id)) })) console.log(`  ${line}`);
  section("花费");
  costs(tree, parsed.entries);
  section("诊断");
  const findings = diagnose(parsed, tree);
  printFindings(findings);
  const tape = tapeFile ? exchanges(parseTape(readSessionFile(tapeFile))) : [];
  const tapeProblems = tapeFile ? tapeFindings(tape, parsed.entries, parsed.header.id) : [];
  if (tapeFile) {
    section("磁带");
    printTape(tape);
    printFindings(tapeProblems);
  }
  if (redactTo) {
    const { entries, stats } = redactEntries(parsed.entries);
    writeSessionCopy(redactTo, parsed.header, entries);
    console.log(`\n  已写脱敏副本 ${redactTo}：密钥 ${stats.secrets} 处，图片 ${stats.images} 张`);
  }
  return hasBlocking([...findings, ...tapeProblems]) ? 1 : 0;
}

function envReport(): number {
  console.log(`  日志目录：${agentDir(process.env, homedir())}`);
  for (const v of DEBUG_VARS) console.log(`  ${v.name.padEnd(22)} ${v.activation.padEnd(10)} ${v.purpose}`);
  const set = checkEnv(process.env);
  section(set.length ? "当前环境里设了的" : "当前环境里一个也没设");
  for (const c of set) console.log(`  ${c.name}=${c.value} → ${c.active ? "生效" : "不生效"}${c.notes.map((n) => `\n    · ${n}`).join("")}`);
  return 0;
}

function doctor(): number {
  const checks = runChecks(probe(process.env, homedir(), process.version, process.platform));
  printChecks(checks);
  return hasFailure(checks) ? 1 : 0;
}

function main(args: readonly string[]): number {
  if (args.length === 0) {
    demo();
    return 0;
  }
  if (args[0] === "--env") return envReport();
  if (args[0] === "--doctor") return doctor();
  return inspect(args);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof SessionFileError || error instanceof SessionFormatError || error instanceof TapeFormatError) {
    console.error(`错误：${error.message}`);
    process.exit(2);
  }
  throw error;
}
