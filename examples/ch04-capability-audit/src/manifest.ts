// 能力清单的形状与校验。清单可以来自内置预设，也可以来自用户给的 JSON 文件——后者是外部输入，必须校验。

/** 一次 git grep：在 paths（glob pathspec）里找 pattern（POSIX 扩展正则） */
export interface Probe {
  readonly pattern: string;
  readonly paths: readonly string[];
  readonly ignoreCase?: boolean;
}

export interface Capability {
  readonly id: string;
  readonly name: string;
  /** 任一命中 = 实现存在。按顺序试，第一个有命中的探针提供证据 */
  readonly present: readonly Probe[];
  /** 可选。实现存在时，任一命中 = 有调用点；全部落空 = 契约在、未接线 */
  readonly wired?: readonly Probe[];
  /** 可选。任一命中 = 有书面的「不做」声明 */
  readonly declared?: readonly Probe[];
}

export class ManifestError extends Error {}

const ID = /^[a-z][a-z0-9-]*$/;

function fail(where: string, what: string): never {
  throw new ManifestError(`${where}：${what}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown, where: string): string {
  if (typeof v !== "string" || v.trim() === "") fail(where, "需要非空字符串");
  return v;
}

function parseProbe(raw: unknown, where: string): Probe {
  if (!isRecord(raw)) fail(where, "需要对象 { pattern, paths, ignoreCase? }");
  const pattern = nonEmptyString(raw.pattern, `${where}.pattern`);
  if (!Array.isArray(raw.paths) || raw.paths.length === 0) fail(`${where}.paths`, "需要非空数组");
  const paths = raw.paths.map((p, i) => nonEmptyString(p, `${where}.paths[${i}]`));
  if (raw.ignoreCase !== undefined && typeof raw.ignoreCase !== "boolean") fail(`${where}.ignoreCase`, "需要布尔值");
  return { pattern, paths, ignoreCase: raw.ignoreCase === true };
}

function parseProbes(raw: unknown, where: string, required: boolean): Probe[] | undefined {
  if (raw === undefined && !required) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) fail(where, "需要非空数组");
  return raw.map((p, i) => parseProbe(p, `${where}[${i}]`));
}

function parseCapability(raw: unknown, where: string): Capability {
  if (!isRecord(raw)) fail(where, "需要对象");
  const id = nonEmptyString(raw.id, `${where}.id`);
  if (!ID.test(id)) fail(`${where}.id`, `「${id}」只能用小写字母、数字和连字符`);
  const at = `${where}（${id}）`;
  return {
    id,
    name: nonEmptyString(raw.name, `${at}.name`),
    present: parseProbes(raw.present, `${at}.present`, true) ?? [],
    wired: parseProbes(raw.wired, `${at}.wired`, false),
    declared: parseProbes(raw.declared, `${at}.declared`, false),
  };
}

/** 把任意 JSON 值校验成能力清单；第一处不合法就抛出，消息里带路径 */
export function parseManifest(raw: unknown): Capability[] {
  if (!Array.isArray(raw) || raw.length === 0) fail("清单", "顶层需要非空数组");
  const caps = raw.map((c, i) => parseCapability(c, `清单[${i}]`));
  const seen = new Set<string>();
  for (const { id } of caps) {
    if (seen.has(id)) fail("清单", `id「${id}」重复`);
    seen.add(id);
  }
  return caps;
}
