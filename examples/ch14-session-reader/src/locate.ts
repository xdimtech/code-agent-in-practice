// 会话文件在哪：<agentDir>/sessions/<按 cwd 编码的目录>/<时间戳>_<会话 id>.jsonl
// 目录名规则 core/session-manager.ts:476-481，文件名规则 :953-954。

export const SESSION_FILE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\.jsonl$/;

/** "/work/shop" → "--work-shop--"。编码有损：/work/shop 和 /work-shop 会落进同一个目录 */
export function sessionDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function sessionFileName(isoTimestamp: string, sessionId: string): string {
  return `${isoTimestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`;
}

export interface SessionFileName {
  /** 还原回 ISO 8601 */
  readonly startedAt: string;
  readonly sessionId: string;
}

export function parseSessionFileName(name: string): SessionFileName | undefined {
  const m = SESSION_FILE.exec(name);
  if (!m) return undefined;
  const [date, time] = m[1]!.split("T") as [string, string];
  const [hh, mm, ss, ms] = time.slice(0, -1).split("-");
  return { startedAt: `${date}T${hh}:${mm}:${ss}.${ms}Z`, sessionId: m[2]! };
}
