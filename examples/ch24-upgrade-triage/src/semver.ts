// 只处理 x.y.z 三段数字。预发布、构建元数据都不认——认不出来就报错，不猜。

export type Version = readonly [number, number, number];
export type Part = "major" | "minor" | "patch";

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export class VersionError extends Error {}

export function parseVersion(text: string): Version {
  const m = PATTERN.exec(text.trim());
  if (!m) throw new VersionError(`不是 x.y.z 形式的版本号：${text}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** 从 prev 到 next，最高变了哪一段 */
export function changedPart(prev: string, next: string): Part {
  const [x, y] = [parseVersion(prev), parseVersion(next)];
  if (x[0] !== y[0]) return "major";
  return x[1] !== y[1] ? "minor" : "patch";
}
