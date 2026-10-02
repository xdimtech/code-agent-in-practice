import { decide } from "./decide.ts";
import { demo } from "./demo.ts";
import { readOverlay } from "./load.ts";
import { replaceMerge, tighten } from "./merge.ts";
import { PolicyFormatError } from "./policy-file.ts";
import { analysisLabel, formatDecision } from "./report.ts";
import { DEFAULT_POLICY, type Origin, type Policy } from "./types.ts";

const USAGE = "用法：npm start -- <命令> [--user] [--user-policy <文件>] [--project-policy <文件>]";
const VALUE_OPTIONS = ["--user-policy", "--project-policy"];
const EXIT_CODE = { allow: 0, ask: 1, deny: 2 } as const;

class UsageError extends Error {}

/** 取 --name 后面的值；没给这个选项返回 undefined，给了但没有值就报错 */
function option(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new UsageError(`${name} 后面要跟文件路径`);
  return value;
}

/** 用户自己的文件是可信的，可以放松默认值；项目文件只能在此基础上收紧 */
function loadPolicy(args: readonly string[], cwd: string): Policy {
  const userFile = option(args, "--user-policy");
  const projectFile = option(args, "--project-policy");
  const base = userFile ? replaceMerge(DEFAULT_POLICY, readOverlay(userFile)) : DEFAULT_POLICY;
  if (!projectFile) return base;
  const { policy, ignored } = tighten(base, readOverlay(projectFile), cwd);
  for (const line of ignored) console.error(`忽略项目策略里的放松请求：${line}`);
  return policy;
}

function check(args: readonly string[]): number {
  const cwd = process.cwd();
  const policy = loadPolicy(args, cwd);
  const command = args.find((a, i) => !a.startsWith("--") && !VALUE_OPTIONS.includes(args[i - 1] ?? ""));
  if (!command) throw new UsageError(USAGE);
  const origin: Origin = args.includes("--user") ? "user" : "model";
  const decision = decide(policy, { origin, tool: "bash", command }, cwd);
  console.log(`  分析：${analysisLabel(command)}`);
  console.log(`  决定：${formatDecision(decision)}`);
  return EXIT_CODE[decision.verdict];
}

try {
  const args = process.argv.slice(2);
  if (args.length === 0) await demo();
  else process.exitCode = check(args);
} catch (error) {
  if (error instanceof UsageError || error instanceof PolicyFormatError) {
    console.error(`错误：${error.message}`);
    process.exit(64);
  }
  throw error;
}
