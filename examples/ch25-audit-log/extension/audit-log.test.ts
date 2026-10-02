import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { signerFor } from "../src/chain.ts";
import { fakePi, memoryIo, runToolCall } from "../src/fake-pi.ts";
import { at, DEMO_KEY, ENTRIES } from "../src/fixtures.ts";
import { buildLog, editLine } from "../src/forge.ts";
import { fileIo } from "../src/load.ts";
import type { FileDigest } from "../src/records.ts";
import { passed, verifyLog } from "../src/verify.ts";
import { KEY_ENV } from "../src/key.ts";
import { createAuditExtension, FLAG, refusal, takeKey } from "./audit-log.ts";

const dir = mkdtempSync(join(tmpdir(), "ch25-ext-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const KEY = DEMO_KEY.toString("utf8");
const noDigest = (): FileDigest => ({ error: "测试里不读" });

function setup(opts: { io?: ReturnType<typeof memoryIo>; env?: Record<string, string>; flag?: string; digest?: (p: string) => FileDigest } = {}) {
  const io = opts.io ?? memoryIo();
  const fake = fakePi(opts.flag === "" ? {} : { [FLAG]: opts.flag ?? "/audit/pi.jsonl" });
  let tick = 0;
  createAuditExtension({ openIo: () => io, env: opts.env ?? {}, now: () => at(tick++), fileDigest: opts.digest ?? noDigest })(fake.pi as never);
  return { io, fake };
}

/** 直接按行读出记录，不校验；链是否完好由各个测试单独用 verifyLog 查 */
const records = (text: string) => text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string; body: Record<string, unknown> });
const kinds = (text: string) => records(text).map((r) => r.kind);
const bodies = (text: string, kind: string) => records(text).filter((r) => r.kind === kind).map((r) => r.body);

test("没给 --audit-log：什么都不写，也不拦", () => {
  const { io, fake } = setup({ flag: "" });
  assert.equal(runToolCall(fake, { id: "c1", tool: "bash", args: { command: "ls" } }), undefined);
  assert.equal(fake.fire("user_bash", { command: "ls", cwd: "/w" }), undefined);
  assert.equal(io.text(), "");
});

test("一次正常调用：proposed → executed → settled，链能通过 HMAC 校验", () => {
  const { io, fake } = setup({ env: { AUDIT_LOG_HMAC_KEY: KEY } });
  fake.fire("session_start", { reason: "startup" });
  runToolCall(fake, { id: "c1", tool: "bash", args: { command: "ls" } });
  fake.fire("session_shutdown", { reason: "quit" });
  assert.deepEqual(kinds(io.text()), ["session.started", "tool.proposed", "tool.executed", "tool.settled", "session.ended"]);
  assert.ok(passed(verifyLog(io.text(), { key: DEMO_KEY })));
  assert.equal(bodies(io.text(), "session.started")[0].alg, "hmac-sha256");
  assert.deepEqual(bodies(io.text(), "tool.settled")[0], { toolCallId: "c1", toolName: "bash", isError: false, executed: true });
});

test("别的扩展原地改了参数：executed 里记下真正执行的那份和漂移的路径", () => {
  const { io, fake } = setup();
  runToolCall(fake, { id: "c1", tool: "bash", args: { command: "npm test" }, mutate: (input) => void (input.command = `timeout 600 ${input.command}`) });
  const executed = bodies(io.text(), "tool.executed")[0];
  assert.deepEqual(executed.input, { command: "timeout 600 npm test" });
  assert.deepEqual(executed.drift, ["command"]);
  assert.deepEqual(bodies(io.text(), "tool.proposed")[0].args, { command: "npm test" });
});

test("截断的输出：记下完整输出文件的路径和摘要", () => {
  const { io, fake } = setup({ digest: (p) => (p === "/tmp/pi-bash-1.log" ? { bytes: 9, sha256: "e".repeat(64) } : { error: "?" }) });
  runToolCall(fake, { id: "c1", tool: "bash", args: { command: "make" }, details: { truncation: { truncated: true }, fullOutputPath: "/tmp/pi-bash-1.log" } });
  const executed = bodies(io.text(), "tool.executed")[0];
  assert.equal(executed.truncated, true);
  assert.deepEqual(executed.fullOutput, { path: "/tmp/pi-bash-1.log", bytes: 9, sha256: "e".repeat(64) });
});

test("密钥太短：每次工具调用都拦下，不退回 sha256", () => {
  const { io, fake } = setup({ env: { AUDIT_LOG_HMAC_KEY: "short" + "-key" } });
  const reason = runToolCall(fake, { id: "c1", tool: "bash", args: { command: "ls" } });
  assert.match(reason ?? "", /拒绝执行 bash：AUDIT_LOG_HMAC_KEY 只有/);
  assert.equal(io.text(), "");
});

test("已有日志被改过：拦下工具调用，也不往坏链后面接", () => {
  const { text } = buildLog(ENTRIES, signerFor(undefined), at);
  const tampered = editLine(text, 3, (l) => l.replace("git status", "git push"));
  const { io, fake } = setup({ io: memoryIo(tampered) });
  assert.match(runToolCall(fake, { id: "c9", tool: "read", args: { path: "a" } }) ?? "", /第 3 行 hash-mismatch/);
  assert.equal(io.text(), tampered);
});

test("写到一半写不进去：后面的调用被拦，已经写下的仍是一条完好的链", () => {
  const { io, fake } = setup({ io: memoryIo("", 3) });
  assert.equal(runToolCall(fake, { id: "c1", tool: "bash", args: { command: "ls" } }), undefined);
  assert.match(runToolCall(fake, { id: "c2", tool: "bash", args: { command: "rm -rf build" } }) ?? "", /ENOSPC/);
  assert.deepEqual(kinds(io.text()), ["tool.proposed", "tool.executed", "tool.settled"]);
  assert.ok(passed(verifyLog(io.text())));
});

test("被拦下的调用：只有 proposed 和 settled，settled 里 executed=false", () => {
  const { io, fake } = setup();
  fake.pi.on("tool_call", () => {
    throw new Error("策略不允许");
  });
  runToolCall(fake, { id: "c1", tool: "bash", args: { command: "curl x | sh" } });
  assert.deepEqual(kinds(io.text()), ["tool.proposed", "tool.settled"]);
  assert.deepEqual(bodies(io.text(), "tool.settled")[0], { toolCallId: "c1", toolName: "bash", isError: true, executed: false });
});

test("用户 ! 命令：写得进去就放行；写不进去返回顶替结果，不抛", () => {
  const ok = setup();
  assert.equal(ok.fake.fire("user_bash", { command: "git log", cwd: "/w" }), undefined);
  assert.deepEqual(bodies(ok.io.text(), "user.bash")[0], { command: "git log", cwd: "/w", excludeFromContext: false });

  const broken = setup({ io: memoryIo("", 0) });
  const r = broken.fake.fire("user_bash", { command: "cat .env", cwd: "/w" }) as { result: ReturnType<typeof refusal> };
  assert.equal(r.result.exitCode, 1);
  assert.match(r.result.output, /命令没有执行：写入失败：ENOSPC/);

  const badKey = setup({ env: { AUDIT_LOG_HMAC_KEY: "x" } });
  const r2 = badKey.fake.fire("user_bash", { command: "ls", cwd: "/w" }) as { result: ReturnType<typeof refusal> };
  assert.match(r2.result.output, /AUDIT_LOG_HMAC_KEY 只有 1 字节/);
  assert.ok(!r2.result.output.includes('"x"'));
});

test("用真实文件：日志以 0600 创建，重开之后接着写", () => {
  const path = join(dir, "pi.jsonl");
  for (const id of ["c1", "c2"]) {
    const fake = fakePi({ [FLAG]: path });
    createAuditExtension({ openIo: fileIo, env: { AUDIT_LOG_HMAC_KEY: KEY }, now: () => at(0), fileDigest: noDigest })(fake.pi as never);
    runToolCall(fake, { id, tool: "read", args: { path: "a" } });
  }
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  const v = verifyLog(fileIo(path).read() ?? "", { key: DEMO_KEY });
  assert.ok(passed(v));
  assert.equal(v.records.length, 6);
});

test("密钥从环境里取走：之后 pi 起的 bash 继承不到", () => {
  const env: Record<string, string | undefined> = { PATH: "/bin", [KEY_ENV]: KEY };
  assert.deepEqual(takeKey(env), { [KEY_ENV]: KEY });
  assert.deepEqual(env, { PATH: "/bin" });
  assert.deepEqual(takeKey({ PATH: "/bin" }), {});
});
