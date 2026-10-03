import { lstatSync, readFileSync } from "node:fs";
import { checkCaptured, hasErrors } from "./check.ts";
import { choose, type Needs } from "./choose.ts";
import { demo } from "./demo.ts";
import { PROFILES, switchCost } from "./modes.ts";
import { printFindings } from "./report.ts";
import { type Form, InputError } from "./types.ts";

const USAGE = `用法：
  npm start                                         演示
  npm start -- check <录下的输出.jsonl>               检查 --mode json / rpc 的输出：分帧、成败、挂住的对话框
  npm start -- switch <from> <to>                   换形态时契约上有哪些维度不同（interactive / print / json / rpc / sdk）
  npm start -- choose --viewer <pi-terminal|own-ui|nobody> --host <node|other> --turns <one|many> [--events]`;

const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const FORMS = Object.keys(PROFILES) as Form[];

function readCapture(path: string): string {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    throw new InputError(`找不到文件：${path}`);
  }
  if (!st.isFile()) throw new InputError(`不是普通文件（符号链接不跟随）：${path}`);
  if (st.size > MAX_CAPTURE_BYTES) throw new InputError(`文件超过上限 ${MAX_CAPTURE_BYTES} 字节：${path}`);
  return readFileSync(path, "utf8");
}

function check(args: readonly string[]): number {
  const [path] = args;
  if (!path) throw new InputError(USAGE);
  const r = checkCaptured(readCapture(path));
  console.log(`${r.lines} 行，看起来是 ${r.mode === "unknown" ? "未知格式" : `--mode ${r.mode}`} 的输出`);
  printFindings(r.findings, 40);
  return hasErrors(r) ? 1 : 0;
}

const asForm = (v: string | undefined): Form => {
  if (v && (FORMS as string[]).includes(v)) return v as Form;
  throw new InputError(`形态只能是 ${FORMS.join(" / ")}，收到：${String(v)}`);
};

function switching(args: readonly string[]): number {
  const changes = switchCost(asForm(args[0]), asForm(args[1]));
  for (const c of changes) console.log(`${c.dimension}：${c.from} → ${c.to}`);
  console.log(`共 ${changes.length} 个维度不同`);
  return 0;
}

function option<T extends string>(args: readonly string[], name: string, allowed: readonly T[]): T {
  const i = args.indexOf(name);
  const v = i === -1 ? undefined : args[i + 1];
  if (v && (allowed as readonly string[]).includes(v)) return v as T;
  throw new InputError(`${name} 只能是 ${allowed.join(" / ")}`);
}

function chooseCmd(args: readonly string[]): number {
  const needs: Needs = {
    viewer: option(args, "--viewer", ["pi-terminal", "own-ui", "nobody"] as const),
    host: option(args, "--host", ["node", "other"] as const),
    turns: option(args, "--turns", ["one", "many"] as const),
    events: args.includes("--events"),
  };
  const c = choose(needs);
  console.log(`${c.form}：${c.why}`);
  for (const cost of c.costs) console.log(`  代价：${cost}`);
  return 0;
}

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => number>> = { check, switch: switching, choose: chooseCmd };

async function main(args: readonly string[]): Promise<number> {
  if (args.length === 0) {
    await demo();
    return 0;
  }
  const run = COMMANDS[args[0]];
  if (!run) throw new InputError(USAGE);
  return run(args.slice(1));
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(e instanceof InputError ? e.message : `内部错误：${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = e instanceof InputError ? 2 : 70;
  },
);
