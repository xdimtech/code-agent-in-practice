// 磁带和会话对一遍：磁带回答「模型收到了什么」，但它自己也有漏的地方，读之前要知道漏在哪。

import type { Finding } from "./diagnose.ts";
import type { Exchange } from "./tape.ts";
import type { Entry } from "./types.ts";

const finding = (severity: Finding["severity"], code: string, message: string): Finding => ({ severity, code, message });

export function tapeFindings(tape: readonly Exchange[], entries: readonly Entry[], sessionId: string): Finding[] {
  const ids = new Set(entries.map((e) => e.id));
  const foreign = tape.filter((x) => x.request.sessionId !== sessionId);
  const summaries = entries.filter((e) => (e.type === "compaction" || e.type === "branch_summary") && e.usage !== undefined).length;
  const secrets = tape.reduce((n, x) => n + x.request.redactedSecrets, 0);
  return [
    ...(foreign.length ? [finding("高", "tape:foreign", `${foreign.length} 次请求来自别的会话（${foreign[0]!.request.sessionId}）：磁带和会话文件不是同一次`)] : []),
    ...tape
      .filter((x) => x.request.sessionId === sessionId && x.request.leafId !== null && !ids.has(x.request.leafId))
      .map((x) => finding("中", "tape:unknown-leaf", `#${x.request.seq} 发出时的叶子 ${x.request.leafId} 不在会话文件里`)),
    ...tape
      .filter((x) => !x.response)
      .map((x) => finding("中", "tape:no-response", `#${x.request.seq} 只有请求、没有响应头：请求没成功。被重试或最终失败的响应多数 provider 上不触发钩子`)),
    ...tape
      .filter((x) => x.response && x.response.status >= 400)
      .map((x) => finding("中", "tape:status", `#${x.request.seq} 响应状态 ${x.response!.status}`)),
    ...(summaries ? [finding("提示", "tape:summaries", `会话里有 ${summaries} 次摘要请求（压缩 / 分支摘要），它们不经过钩子，磁带里没有`)] : []),
    ...(secrets ? [finding("提示", "tape:redacted", `落盘前遮掉了请求体里的 ${secrets} 处密钥`)] : []),
  ];
}
