import { makeAnchor } from "./anchor.ts";
import { signerFor } from "./chain.ts";
import { type Call, fakePi, memoryIo, runToolCall } from "./fake-pi.ts";
import { at, DEMO_KEY, ENTRIES, OTHER_KEY, PI_SESSION } from "./fixtures.ts";
import { buildLog, dropTail, editLine, reseal } from "./forge.ts";
import { KEY_ENV } from "./key.ts";
import { printFacts, printFindings, printRecords, printVerification, section } from "./report.ts";
import { inspectSession } from "./session-check.ts";
import { verifyLog } from "./verify.ts";
import { createAuditExtension, FLAG } from "../extension/audit-log.ts";

const SHA = signerFor(undefined);
const HMAC = signerFor(DEMO_KEY);

/** 第 5 行是 rm -rf build 的执行记录；把它改成一条无害的命令 */
const HARMLESS = { toolCallId: "c2", toolName: "bash", input: { command: "ls build" }, drift: [], isError: false };

function tamperSection(): void {
  const { text, records } = buildLog(ENTRIES, SHA, at);
  section("二、改一行：把 rm -rf build 改成 ls build");
  console.log("  原样：");
  printRecords(records);
  printVerification(verifyLog(editLine(text, 5, (l) => l.replace("rm -rf build", "ls build"))));

  section("三、删末尾两行：没有锚点查不出来");
  const anchor = makeAnchor(records[records.length - 1], at(60));
  console.log("  不带锚点：");
  printVerification(verifyLog(dropTail(text, 2)));
  console.log(`  带锚点（第 ${anchor.seq} 条，存在日志之外）：`);
  printVerification(verifyLog(dropTail(text, 2), { anchor }));
}

function resealSection(): void {
  section("四、改完把后面全部重算：sha256 挡不住，HMAC 和锚点挡得住");
  const plain = buildLog(ENTRIES, SHA, at);
  const forgedPlain = reseal(plain.records, 5, HARMLESS, SHA);
  console.log("  sha256 链，重算后不带锚点：");
  printVerification(verifyLog(forgedPlain));
  console.log("  同一份，带锚点：");
  printVerification(verifyLog(forgedPlain, { anchor: makeAnchor(plain.records[plain.records.length - 1], at(60)) }));
  const keyed = buildLog(ENTRIES, HMAC, at);
  const forgedKeyed = reseal(keyed.records, 5, HARMLESS, signerFor(OTHER_KEY));
  console.log("  HMAC 链，篡改者用自己的密钥重算，校验方用真密钥查：");
  printVerification(verifyLog(forgedKeyed, { key: DEMO_KEY }));
  console.log("  同一份，校验方手里没有密钥：");
  printVerification(verifyLog(forgedKeyed));
}

const DRIFT_CALLS: readonly Call[] = [
  // edit 的 prepareArguments 把旧写法 oldText/newText 并进 edits 数组（core/tools/edit.ts:116-147）
  { id: "c1", tool: "edit", args: { path: "src/a.ts", oldText: "foo", newText: "bar" }, validated: { path: "src/a.ts", edits: [{ oldText: "foo", newText: "bar" }] } },
  // 另一个扩展在 tool_call 里原地改了命令（core/extensions/types.ts:1126 的约定写法）
  { id: "c2", tool: "bash", args: { command: "npm test" }, mutate: (input) => void (input.command = `timeout 600 ${String(input.command)}`), output: "…", details: { truncation: { truncated: true }, fullOutputPath: "/tmp/pi-bash-4f2a.log" } },
];

function driftSection(): void {
  section("五、会话记的参数 vs 真正执行的参数");
  const io = memoryIo();
  const fake = fakePi({ [FLAG]: "/audit/pi.jsonl" });
  createAuditExtension({ openIo: () => io, env: { [KEY_ENV]: DEMO_KEY.toString() }, now: () => at(30), fileDigest: () => ({ error: "文件已经不在了" }) })(fake.pi as never);
  fake.fire("session_start", { reason: "startup" });
  for (const call of DRIFT_CALLS) runToolCall(fake, call);
  const v = verifyLog(io.text(), { key: DEMO_KEY });
  printRecords(v.records);
  for (const r of v.records.filter((r) => r.kind === "tool.executed")) console.log(`  ${JSON.stringify((r.body as { toolName: string }).toolName)} 漂移：${JSON.stringify((r.body as { drift: unknown }).drift)}`);
  console.log("  pi 会话的 assistant 消息里只有 tool.proposed 那份；交给工具的是 tool.executed 那份");
}

function degradedSection(): void {
  section("六、日志写不进去的时候");
  const io = memoryIo("", 2);
  const fake = fakePi({ [FLAG]: "/audit/pi.jsonl" });
  createAuditExtension({ openIo: () => io, env: {}, now: () => at(40), fileDigest: () => ({ error: "没有读" }) })(fake.pi as never);
  const first = runToolCall(fake, { id: "c1", tool: "bash", args: { command: "git status" } });
  console.log(`  第一次调用：${first ?? "执行了"}（写了 ${io.text().split("\n").filter(Boolean).length} 条，磁盘随后满了）`);
  console.log(`  第二次调用（模型）：${runToolCall(fake, { id: "c2", tool: "bash", args: { command: "rm -rf build" } }) ?? "执行了"}`);
  const bash = fake.fire("user_bash", { command: "rm -rf build", cwd: "/work/app" }) as { result?: { output: string; exitCode: number } } | undefined;
  console.log(`  用户 !rm -rf build：${bash?.result ? `顶替结果 exit ${bash.result.exitCode}，${bash.result.output.trim()}` : "执行了"}`);
  console.log("  tool_call 里抛错 = 不执行；user_bash 里抛错会被吞掉、命令照常跑，所以这里返回顶替结果");
}

export function demo(): void {
  section("一、拿一份 pi 会话：它能证明什么");
  const { facts, findings } = inspectSession(PI_SESSION);
  printFacts(facts);
  printFindings(findings);
  tamperSection();
  resealSection();
  driftSection();
  degradedSection();
}
