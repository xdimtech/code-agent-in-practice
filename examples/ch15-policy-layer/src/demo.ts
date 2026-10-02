import { analyzeCommand } from "./command.ts";
import { CORPUS } from "./corpus.ts";
import { PI_EXAMPLES, THIS_EXAMPLE } from "./coverage.ts";
import { toolCallGate, userBashGate, type Ui } from "./hooks.ts";
import { dispatchToolCall, dispatchUserBash, type ToolCallHandler } from "./host.ts";
import { replaceMerge, tighten } from "./merge.ts";
import { piGateFlags } from "./pi-gate.ts";
import { formatOutcome, printCorpus, printCoverage, section } from "./report.ts";
import { DEFAULT_POLICY, type PolicyOverlay } from "./types.ts";

const CWD = "/work/repo";
const COMMAND = "rm -rf build";

/** pi 的 permission-gate 示例在没有界面时的行为：命中就拦（permission-gate.ts:20-23） */
const piGate: ToolCallHandler = (event) =>
  event.toolName === "bash" && piGateFlags(String(event.input.command)) ? { block: true, reason: "Dangerous command blocked (no UI for confirmation)" } : undefined;

const brokenGate = (): never => {
  throw new Error("规则文件读不出来");
};

async function twoPaths(): Promise<void> {
  section("一、同一条命令，两条路（只在 tool_call 上挂了 pi 的 permission-gate）");
  console.log(`  模型调 bash：${formatOutcome(await dispatchToolCall([piGate], { toolName: "bash", input: { command: COMMAND } }))}`);
  console.log(`  用户敲 !  ：${formatOutcome(await dispatchUserBash([], { command: COMMAND, cwd: CWD }))}`);
}

async function failureModes(): Promise<void> {
  section("二、处理器抛错时，两条路的结局相反");
  console.log(`  tool_call ：${formatOutcome(await dispatchToolCall([brokenGate], { toolName: "bash", input: { command: "ls" } }))}`);
  console.log(`  user_bash ：${formatOutcome(await dispatchUserBash([brokenGate], { command: "ls", cwd: CWD }))}`);
}

function regexVsParse(): void {
  section("三、正则比的是整行字符串，分析器比的是词");
  printCorpus(CORPUS);
  const blind = CORPUS.filter((s) => s.destructive && !piGateFlags(s.command) && analyzeCommand(s.command).analysis.kind === "ordinary");
  console.log(`  两边都看不出来的有 ${blind.length} 条：静态规则到这里为止，再往下是沙箱的事`);
}

function merging(): void {
  section("四、项目配置想把限制放开");
  const overlay: PolicyOverlay = { mode: "auto", protectedPaths: [], writeRoots: ["/"], gateUserCommands: false };
  console.log(`  项目文件：${JSON.stringify(overlay)}`);
  console.log(`  后者覆盖：${JSON.stringify(replaceMerge(DEFAULT_POLICY, overlay))}`);
  const { policy, ignored } = tighten(DEFAULT_POLICY, overlay, CWD);
  console.log(`  只许收紧：${JSON.stringify(policy)}`);
  for (const line of ignored) console.log(`    忽略：${line}`);
}

async function onePolicy(): Promise<void> {
  section("五、一份策略接两条路");
  const yes: Ui = { confirm: async () => true };
  const cases: readonly { label: string; ui?: Ui; broken?: boolean }[] = [{ label: "有界面，用户点了同意", ui: yes }, { label: "没有界面" }];
  for (const c of cases) {
    const options = { policy: DEFAULT_POLICY, cwd: CWD, ui: c.ui };
    const model = await dispatchToolCall([toolCallGate(options)], { toolName: "bash", input: { command: COMMAND } });
    const user = await dispatchUserBash([userBashGate(options)], { command: COMMAND, cwd: CWD });
    console.log(`  ${c.label}\n    模型调 bash：${formatOutcome(model)}\n    用户敲 !  ：${formatOutcome(user)}`);
  }
  const explode: Ui = { confirm: async () => Promise.reject(new Error("确认框崩了")) };
  const user = await dispatchUserBash([userBashGate({ policy: DEFAULT_POLICY, cwd: CWD, ui: explode })], { command: COMMAND, cwd: CWD });
  console.log(`  确认框自己抛错\n    用户敲 !  ：${formatOutcome(user)}`);
}

function coverage(): void {
  section("六、每道闸门管得到哪些路径");
  printCoverage([...PI_EXAMPLES, THIS_EXAMPLE]);
}

export async function demo(): Promise<void> {
  await twoPaths();
  await failureModes();
  regexVsParse();
  merging();
  await onePolicy();
  coverage();
}
