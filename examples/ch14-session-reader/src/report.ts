// 演示和命令行共用的打印函数。

import type { Check } from "./doctor.ts";
import type { Finding } from "./diagnose.ts";
import type { ParsedSession } from "./jsonl.ts";
import { sessionDirName, sessionFileName } from "./locate.ts";
import type { ReplayResult } from "./replay.ts";
import { payloadShape, type Exchange } from "./tape.ts";
import type { SessionTree } from "./tree.ts";
import { isAssistant, type Entry } from "./types.ts";
import { breakdown, calculateCost, sumEntries, usd, type Rates } from "./usage.ts";
import type { Dropped, WireMessage } from "./wire.ts";

/** 演示用：假设价格表后来下调了输入价 */
const NEW_RATES: Rates = { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 };

export const section = (title: string) => console.log(`\n== ${title} ==`);

export function printFindings(findings: readonly Finding[]): void {
  for (const f of findings) console.log(`  [${f.severity}] ${f.entryId ? `${f.entryId} ` : ""}${f.message}`);
  if (findings.length === 0) console.log("  没有发现问题");
}

export function summarize(parsed: ParsedSession, tree: SessionTree): void {
  const h = parsed.header;
  console.log(`  会话 ${h.id} · 版本 ${h.version ?? 1} · cwd ${h.cwd}`);
  console.log(`  应在 <agentDir>/sessions/${sessionDirName(h.cwd)}/${sessionFileName(h.timestamp, h.id)}`);
  console.log(`  条目 ${parsed.entries.length} · 跳过的行 ${parsed.problems.length} · 叶子 ${tree.leafId ?? "无"}`);
  console.log(`  当前对话 ${tree.activePath.length} 条 · 不在当前对话上 ${tree.offPath.length} 条 · 发给模型的上下文 ${tree.context.length} 条`);
}

export function costs(tree: SessionTree, all: readonly Entry[]): void {
  console.log(`  文件里全部条目：${usd(sumEntries(all).cost)}  ← /session 和底栏显示的数`);
  console.log(`  只算当前对话：  ${usd(sumEntries(tree.activePath).cost)}`);
  console.log(`  被放弃的分支：  ${usd(sumEntries(tree.offPath).cost)}`);
  for (const { key, totals } of breakdown(all)) console.log(`    ${key.padEnd(36)} ${usd(totals.cost)}  ↑${totals.input} ↓${totals.output} R${totals.cacheRead} W${totals.cacheWrite}`);
  const first = all.find((e) => isAssistant(e.message));
  if (first && isAssistant(first.message)) {
    const recorded = first.message.usage.cost.total;
    console.log(`  ${first.id} 记录的花费 ${usd(recorded)}；同样的用量按新价格表算是 ${usd(calculateCost(NEW_RATES, first.message.usage).total)}——历史不跟着变`);
  }
}

export function printWire(messages: readonly WireMessage[], dropped: readonly Dropped[]): void {
  for (const m of messages) console.log(`  ${m.role.padEnd(10)} ← ${m.from ?? "（凭空）"}${m.note ? `  ${m.note}` : ""}`);
  for (const d of dropped) console.log(`  不发        ✗ ${d.from}  ${d.reason}`);
}

export function printTape(tape: readonly Exchange[]): void {
  for (const x of tape) {
    const s = payloadShape(x.request.payload);
    const outcome = x.response ? `HTTP ${x.response.status}` : "（无响应头）";
    console.log(`  #${x.request.seq} 叶子 ${x.request.leafId ?? "无"} · ${s.model} · system ${s.systemChars} 字 · ${s.roles.length} 条消息 · ${s.tools} 个工具 → ${outcome} · ${x.request.fingerprint}`);
  }
}

export function replayLine(results: readonly ReplayResult[], total: number): string {
  const hits = results.filter((r) => r.kind === "hit").length;
  const last = results.at(-1);
  if (!last || last.kind === "hit") return `${hits}/${total} 命中`;
  if (last.kind === "diverged") return `命中 ${hits} 个，#${last.seq} 分岔于 ${last.path}\n      磁带：${last.recorded}\n      现在：${last.incoming}`;
  if (last.kind === "no-answer") return `命中 ${hits} 个，#${last.seq} 请求对得上，但磁带里没录到回答`;
  return `命中 ${hits} 个，第 ${last.asked} 个请求超出了磁带（只录了 ${last.recorded} 个）`;
}

export function printChecks(checks: readonly Check[]): void {
  for (const c of checks) console.log(`  [${c.status}] ${c.name}：${c.detail}`);
}
