import { join } from "node:path";
import { checkCaptured } from "./check.ts";
import { choose, type Needs } from "./choose.ts";
import { explain, runTurn } from "./client.ts";
import { EVENT_WITH_LS, jsonCapture } from "./fixtures.ts";
import { splitGeneric, splitStrict, takeLinesGeneric } from "./jsonl.ts";
import { type LaunchArgs, resolveAppMode, switchCost } from "./modes.ts";
import { printFindings } from "./report.ts";
import type { Form } from "./types.ts";

const fakeAgent = join(import.meta.dirname, "fake-agent.ts");
const agentArgs = ["--experimental-strip-types", "--no-warnings", fakeAgent];

function launches() {
  console.log("一、一次启动落到哪种形态（main.ts:110-121 的判断顺序）\n");
  const cases: readonly [string, LaunchArgs, boolean, boolean][] = [
    ["pi", {}, true, true],
    ["pi -p \"…\"", { print: true }, true, true],
    ["echo … | pi", {}, false, true],
    ["pi \"…\" > out.txt", {}, true, false],
    ["pi --mode json \"…\"", { mode: "json" }, true, true],
    ["pi --mode rpc", { mode: "rpc" }, false, false],
  ];
  for (const [cmd, args, stdin, stdout] of cases) {
    console.log(`  ${cmd.padEnd(22)} stdin${stdin ? "是" : "不是"}终端 stdout${stdout ? "是" : "不是"}终端 → ${resolveAppMode(args, { stdin, stdout })}`);
  }
}

function framing() {
  console.log("\n二、同一行 JSONL，两种切法\n");
  const strict = splitStrict(EVENT_WITH_LS);
  const generic = splitGeneric(EVENT_WITH_LS);
  console.log(`  只按 \\n 切：${strict.length} 行；JSON.parse ${strict.every(parses) ? "全部成功" : "有失败"}`);
  console.log(`  通用分行器：${generic.length} 段；JSON.parse 成功 ${generic.filter(parses).length} 段`);
}

const parses = (l: string) => {
  try {
    JSON.parse(l);
    return true;
  } catch {
    return false;
  }
};

async function realChild() {
  console.log("\n三、真起一个子进程跑一轮（src/fake-agent.ts 模拟 --mode rpc）\n");
  const strict = await runTurn({ type: "prompt", message: "你好" }, { command: process.execPath, args: agentArgs, policy: "cancel", timeoutMs: 5000 });
  console.log(`  严格分帧：${explain(strict)}；问题 ${strict.state.problems.length} 个`);
  const generic = await runTurn({ type: "prompt", message: "你好" }, { command: process.execPath, args: agentArgs, policy: "cancel", timeoutMs: 5000, split: takeLinesGeneric });
  console.log(`  通用分行器：${explain(generic)}；问题 ${generic.state.problems.length} 个`);
  for (const p of generic.state.problems) console.log(`    - ${p}`);
}

async function dialogs() {
  console.log("\n四、扩展弹了一个没有超时的确认框\n");
  const opts = { command: process.execPath, args: agentArgs, timeoutMs: 1500 };
  const cancel = await runTurn({ type: "prompt", message: "请 confirm" }, { ...opts, policy: "cancel" });
  console.log(`  宿主自动取消：${explain(cancel)}`);
  const ignore = await runTurn({ type: "prompt", message: "请 confirm" }, { ...opts, policy: "ignore" });
  console.log(`  宿主不回：${explain(ignore)}`);
}

function capture() {
  console.log("\n五、--mode json 的退出码说成功，事件流说失败\n");
  printFindings(checkCaptured(jsonCapture("error")).findings, 10);
}

function switching() {
  console.log("\n六、换形态要改什么\n");
  const pairs: readonly [Form, Form][] = [["print", "rpc"], ["sdk", "rpc"]];
  for (const [from, to] of pairs) {
    const changes = switchCost(from, to);
    console.log(`  ${from} → ${to}：${changes.length} 个维度不同`);
    for (const c of changes) console.log(`    - ${c.dimension}：${c.from} → ${c.to}`);
  }
  console.log("\n  按需求选：");
  const needs: readonly [string, Needs][] = [
    ["CI 里跑一次评审，只要结论", { viewer: "nobody", host: "other", turns: "one", events: false }],
    ["Electron 应用里嵌一个助手", { viewer: "own-ui", host: "node", turns: "many", events: true }],
    ["Python 写的平台调度多轮会话", { viewer: "own-ui", host: "other", turns: "many", events: true }],
  ];
  for (const [what, n] of needs) {
    const c = choose(n);
    console.log(`    ${what} → ${c.form}：${c.why}`);
  }
}

export async function demo(): Promise<void> {
  launches();
  framing();
  await realChild();
  await dialogs();
  capture();
  switching();
}
