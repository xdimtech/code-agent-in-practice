// HMAC 密钥只从环境变量来，不写进代码、不写进策略文件、不写进日志。
// 密钥和日志放在同一个人手里，HMAC 就只防「拿到文件、没拿到密钥」的人；真要防写日志的这台机器，
// 密钥得在别处（校验方持有），或者改用非对称签名。

import { InputError } from "./types.ts";

export const KEY_ENV = "AUDIT_LOG_HMAC_KEY";
export const MIN_KEY_BYTES = 32;

/** 没设返回 undefined（用 sha256）；设了但太短直接报错，不悄悄降级 */
export function keyFromEnv(env: Readonly<Record<string, string | undefined>>): Buffer | undefined {
  const raw = env[KEY_ENV];
  if (raw === undefined || raw === "") return undefined;
  const key = Buffer.from(raw, "utf8");
  if (key.length < MIN_KEY_BYTES) throw new InputError(`${KEY_ENV} 只有 ${key.length} 字节，至少要 ${MIN_KEY_BYTES}（比如 openssl rand -hex 32）`);
  return key;
}
