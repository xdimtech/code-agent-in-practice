# ch03-modes

对应 [第 3 章 四种形态选哪种](../../book/01-choosing/ch03-four-modes.md)。

pi 有交互、print、json、rpc 四种运行形态，再加上直接 import 的 SDK。这个例子把「选哪种」落成能跑的代码：照抄 pi 的形态判定顺序；把每种形态对接入方许下的契约列成九个维度，换形态时逐项比对；真起一个假的 `pi --mode rpc` 子进程，看通用分行器怎样把含 U+2028 的一行切坏、没有超时的对话框怎样把子进程挂住；检查 `--mode json` / `--mode rpc` 录下来的输出。零依赖。

```bash
npm start                                                    # 六段演示
npm start -- check out.jsonl                                 # 检查录下的输出：分帧、这一轮成没成、挂住的对话框
npm start -- switch print rpc                                # 换形态要改哪几处
npm start -- choose --viewer nobody --host other --turns one # 按需求选形态（--events 表示要看过程）
npm test                                                     # 61 个用例
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。退出码：0 正常，1 检查出错误，2 用法或输入有问题。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 形态、扩展看到的 mode、对话框与通知两类 UI 方法 |
| `src/modes.ts` | `resolveAppMode`（照抄 pi `main.ts:110-121`）、五种形态的契约表、换形态的差异 |
| `src/jsonl.ts` | 严格 JSONL 分帧（只认 `\n`）、通用分行器的切法（演示用）、带单行上限的流式读取器 |
| `src/protocol.ts` | RPC stdout 上一行是什么：响应、事件、对话框、通知、坏行 |
| `src/host.ts` | 宿主一侧的状态机（纯函数）：命令编号、响应配对、对话框自动取消或不回 |
| `src/client.ts` | 唯一碰子进程的文件：起进程、喂行、回话、超时 |
| `src/fake-agent.ts` | 假的 `pi --mode rpc`，只模拟本章关心的行为 |
| `src/check.ts` | 检查录下的输出 |
| `src/choose.ts` | 按需求选形态，每条结论带代价 |
| `src/demo.ts` / `src/report.ts` / `src/main.ts` | 演示、输出格式、命令行入口 |
| `src/fixtures.ts` | 演示和测试共用的输入 |
| `src/*.test.ts` | `node:test` 用例；`client.test.ts` 真起子进程 |

接 RPC 的三条经验：

1. **分帧只认 `\n`。** `JSON.stringify` 不转义 U+2028 / U+2029，它们会原样出现在一行中间；把它们当换行的分行器（Node 24 起的 `readline` 就是）会把一行切成几段，每段都解析失败。
2. **对话框一定要回。** 扩展在 rpc 形态下看到 `hasUI=true`，会真的弹框；请求里没带 `timeout` 时子进程会一直等。后面没有人的话，收到就回「取消」。
3. **`--mode json` 的退出码不说成败。** 最后一条助手消息出错也退 0，要从 `agent_end` 里读 `stopReason`。
