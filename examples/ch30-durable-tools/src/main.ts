// 演示：一批两个调用（rm 不可重放，read 可重放），进程在 rm 执行期间被杀；
// 重启后从日志恢复。最后演示一份协议不可能产生的日志被拒绝。

import { JournalCorruption, type JournalRecord } from "./journal.ts";
import { drive, MemoryStore, planBatch, type Tool } from "./recover.ts";

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

function show(title: string, records: readonly JournalRecord[]): void {
  console.log(title);
  for (const r of records) {
    const detail =
      r.type === "batch_planned"
        ? r.calls.map((c) => `${c.id}=${c.name}`).join(" ")
        : r.type === "tool_started"
          ? `${r.toolCallId} replay=${r.replay}`
          : `${r.toolCallId} ${r.isError ? "✗" : "✓"} ${r.text}`;
    console.log(`  #${r.seq} ${r.type.padEnd(13)} ${detail}`);
  }
}

const read: Tool = { name: "read", replay: "safe", execute: async () => "12 行" };
const rmHanging: Tool = { name: "rm", execute: () => new Promise<string>(() => {}) };
const rm: Tool = { name: "rm", execute: async () => "已删除" };

const live = new MemoryStore();
planBatch(live, "b1", [
  { id: "c0", name: "rm", args: { path: "migrations/old" } },
  { id: "c1", name: "read", args: { path: "package.json" } },
]);
void drive(live, [rmHanging, read]);
await tick();
show("崩溃那一刻落盘的日志：", live.read());

const restarted = new MemoryStore(live.read());
await drive(restarted, [rm, read]);
show("重启并恢复之后：", restarted.read());

const broken = new MemoryStore([...restarted.read().slice(0, 2), { ...restarted.read()[1], seq: 3 }]);
try {
  await drive(broken, [rm, read]);
  console.error("损坏的日志居然被接受了");
  process.exit(1);
} catch (error) {
  if (!(error instanceof JournalCorruption)) throw error;
  console.log(`损坏的日志被拒绝：${error.reason}（${error.message}）`);
}
