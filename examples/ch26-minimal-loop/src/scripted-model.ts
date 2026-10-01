// 脚本化的假模型：按顺序吐出预先写好的回复，不需要任何 API key。
// 用来演示循环结构，而不是演示模型能力。

import type { Message } from "./loop.ts";

export function scriptedModel(script: readonly Message[]): (messages: readonly Message[]) => Promise<Message> {
  let cursor = 0;
  return async () => {
    if (cursor >= script.length) {
      throw new Error("脚本已用完：模型被调用的次数多于预期");
    }
    const next = script[cursor];
    cursor += 1;
    return next;
  };
}
