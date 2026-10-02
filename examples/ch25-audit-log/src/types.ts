// 审计日志的全部词汇。一条记录 = 序号 + 时间 + 上一条的哈希 + 种类 + 内容 + 这一条的哈希。
// 改任何一条，它自己的哈希就对不上；把它和后面的哈希全部重算，就要有密钥（HMAC）或者躲过外部锚点。

/** 能落进 JSON、而且序列化结果唯一的值 */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** sha256 谁都能重算，只防意外损坏；hmac-sha256 要密钥才能重算，防有意篡改 */
export type Alg = "sha256" | "hmac-sha256";

export const RECORD_VERSION = 1;

/** 第一条记录的 prev */
export const GENESIS = "0".repeat(64);

export interface AuditRecord {
  readonly v: typeof RECORD_VERSION;
  /** 从 1 开始，连续 */
  readonly seq: number;
  readonly at: string;
  readonly prev: string;
  readonly kind: string;
  readonly body: Json;
  readonly alg: Alg;
  /** 对「去掉 hash 之后的整条记录」的规范 JSON 求摘要 */
  readonly hash: string;
}

/** 调用方只给种类和内容，序号、时间、链接由写入器填 */
export interface Entry {
  readonly kind: string;
  readonly body: Json;
}

/** 链尾：下一条接在谁后面 */
export interface Head {
  readonly seq: number;
  readonly hash: string;
}

/** 存在日志之外的一份链尾快照。日志被截短、或者整条链被重算，都和它对不上 */
export interface Anchor {
  readonly seq: number;
  readonly hash: string;
  readonly at: string;
}

export interface Signer {
  readonly alg: Alg;
  readonly key?: Buffer;
}

export type Severity = "error" | "warn" | "info";

export interface Finding {
  readonly severity: Severity;
  readonly rule: string;
  /** 第几行（从 1 开始），和整份文件有关的发现没有行号 */
  readonly line?: number;
  readonly message: string;
}

/** 命令行参数、文件内容这类外部输入有问题；main.ts 接住后退出 2 */
export class InputError extends Error {}
