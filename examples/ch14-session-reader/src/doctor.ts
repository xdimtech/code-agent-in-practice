// pi 没有 doctor。最接近的是 pi auth check（cli/auth-check.ts:27-53），只回答「这个 provider 的凭据能不能用」。
// 用户说「跑不起来」时，要先排除的是环境：Node 版本、配置目录指到了哪、配置文件能不能解析、凭据文件的权限、
// 有没有忘了关的调试开关。这个模块是一组纯函数检查：输入是一份环境快照（Probe），不碰磁盘，也不读凭据内容。

import { checkEnv } from "./debug-vars.ts";

export type Status = "通过" | "注意" | "失败";

export interface Check {
  readonly status: Status;
  readonly name: string;
  readonly detail: string;
}

export interface FileProbe {
  readonly exists: boolean;
  /** 权限位，已经 & 0o777 */
  readonly mode?: number;
  readonly size?: number;
  /** 只有需要解析的配置文件才读内容；auth.json 永远不读 */
  readonly text?: string;
}

export interface Probe {
  readonly platform: string;
  readonly nodeVersion: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly agentDir: string;
  readonly agentDirExists: boolean;
  readonly auth: FileProbe;
  readonly models: FileProbe;
  readonly settings: FileProbe;
  readonly sessionsDir: FileProbe;
  readonly debugLog: FileProbe;
  readonly crashLog: FileProbe;
}

/** pi 的 engines.node（packages/coding-agent/package.json:103-105） */
export const MIN_NODE: readonly [number, number, number] = [22, 19, 0];

const check = (status: Status, name: string, detail: string): Check => ({ status, name, detail });
const octal = (mode: number) => `0${mode.toString(8).padStart(3, "0")}`;
const othersCanRead = (mode: number | undefined) => mode !== undefined && (mode & 0o077) !== 0;

export function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function versionAtLeast(v: readonly number[], min: readonly number[]): boolean {
  const i = v.findIndex((n, k) => n !== min[k]);
  return i < 0 || v[i]! > min[i]!;
}

/** 和 pi 的 utils/json.ts:2-6 同样的规则：去掉 // 行注释和尾逗号，字符串里的不动 */
export function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail?: string) => tail ?? (m[0] === '"' ? m : ""));
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

const parseError = (text: string): string | undefined => {
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** 这一段前缀在结尾之前就已经不合法了（而不只是没写完） */
function brokenBeforeEnd(prefix: string): boolean {
  const message = parseError(prefix);
  if (message === undefined || /Unexpected end of JSON input/.test(message)) return false;
  const at = /at position (\d+)/.exec(message);
  return at ? Number(at[1]) < prefix.length : true;
}

/** 出错处的偏移。Node 的报错有的带 position，有的不带（「Unexpected token」），不带的就二分找最短的坏前缀 */
function errorOffset(text: string, message: string): number {
  const at = /at position (\d+)/.exec(message);
  if (at) return Number(at[1]);
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (brokenBeforeEnd(text.slice(0, mid))) hi = mid;
    else lo = mid + 1;
  }
  return lo - 1;
}

/** 只报位置。JSON.parse 的报错原文会带出错处前后的几个字符，配置文件里那几个字符可能正好是密钥 */
export function parseProblem(text: string): string | undefined {
  const message = parseError(text);
  if (message === undefined) return undefined;
  const before = text.slice(0, errorOffset(text, message)).split("\n");
  return `第 ${before.length} 行第 ${before.at(-1)!.length + 1} 列`;
}

function nodeCheck(p: Probe): Check {
  const v = parseVersion(p.nodeVersion);
  const min = MIN_NODE.join(".");
  if (!v) return check("失败", "Node 版本", `看不懂版本号 ${JSON.stringify(p.nodeVersion)}`);
  return versionAtLeast(v, MIN_NODE) ? check("通过", "Node 版本", `${v.join(".")}（要求 ≥ ${min}）`) : check("失败", "Node 版本", `${v.join(".")}，低于 pi 要求的 ${min}`);
}

function agentDirCheck(p: Probe): Check {
  const from = p.env.PI_CODING_AGENT_DIR ? "来自 PI_CODING_AGENT_DIR" : "缺省位置";
  if (p.agentDirExists) return check("通过", "配置目录", `${p.agentDir}（${from}）`);
  return check(p.env.PI_CODING_AGENT_DIR ? "失败" : "注意", "配置目录", `${p.agentDir} 不存在（${from}）：pi 会当成全新安装，凭据、设置、会话都找不到`);
}

function authCheck(p: Probe): Check {
  if (!p.auth.exists) return check("注意", "auth.json", "不存在：凭据要靠环境变量或 models.json 提供");
  if (p.platform !== "win32" && othersCanRead(p.auth.mode)) {
    return check("失败", "auth.json", `权限 ${octal(p.auth.mode!)}，别的用户能读；pi 创建它时用的是 0600，多半是被复制或还原过`);
  }
  return check("通过", "auth.json", p.platform === "win32" ? "存在" : `权限 ${octal(p.auth.mode ?? 0)}`);
}

function modelsCheck(p: Probe): Check {
  if (!p.models.exists) return check("通过", "models.json", "不存在：只用内置模型表");
  const problem = parseProblem(stripJsonComments(stripBom(p.models.text ?? "")));
  return problem ? check("失败", "models.json", `解析失败（${problem}）：自定义模型和价格全部不生效`) : check("通过", "models.json", "能解析");
}

function settingsCheck(p: Probe): Check {
  if (!p.settings.exists) return check("通过", "settings.json", "不存在：全部用缺省设置");
  const text = stripBom(p.settings.text ?? "");
  const problem = parseProblem(text);
  if (!problem) return check("通过", "settings.json", "能解析");
  const onlyComments = parseProblem(stripJsonComments(text)) === undefined;
  return check("失败", "settings.json", onlyComments ? `里面有注释或尾逗号（${problem}）：models.json 允许，settings.json 不允许，这一份设置整个不生效` : `解析失败（${problem}）：这一份设置整个不生效`);
}

function leftoverChecks(p: Probe): Check[] {
  return [
    ...(p.platform !== "win32" && p.sessionsDir.exists && othersCanRead(p.sessionsDir.mode)
      ? [check("注意", "会话目录", `权限 ${octal(p.sessionsDir.mode!)}，别的用户能读；会话里有工具参数原文和内联的图片`)]
      : []),
    ...(p.debugLog.exists ? [check("注意", "pi-debug.log", `${p.debugLog.size ?? 0} 字节：如果按过 /debug，里面是那一刻的完整对话；用完删掉`)] : []),
    ...(p.crashLog.exists ? [check("注意", "pi-crash.log", `${p.crashLog.size ?? 0} 字节：有过一次渲染宽度越界的崩溃，里面是当时的整屏内容`)] : []),
  ];
}

function envChecks(p: Probe): Check[] {
  return checkEnv(p.env).map((c) =>
    check("注意", c.name, c.active ? `开着${c.notes.length ? `：${c.notes.join("；")}` : ""}` : (c.notes[0] ?? "设了但不生效")),
  );
}

export function runChecks(p: Probe): Check[] {
  return [nodeCheck(p), agentDirCheck(p), authCheck(p), modelsCheck(p), settingsCheck(p), ...leftoverChecks(p), ...envChecks(p)];
}

export const hasFailure = (checks: readonly Check[]) => checks.some((c) => c.status === "失败");
