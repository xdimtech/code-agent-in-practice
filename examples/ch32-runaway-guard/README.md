# ch32-runaway-guard

对应 [第 32 章 MiniMax：minimax-code](../../book/06-vendors/ch32-minimax.md)。

minimax-code 在 pi 的「零防死循环」上补了一个 runaway-guard：它只**提醒**，不拒绝工具，也不中止一轮。每一轮一把新密钥，用它给工具调用算 HMAC 指纹，跟踪五类连击信号，越过阈值就往这一轮里 steer 一条提醒，一轮最多一条，出任何错都放行。这个例子按同样的思路重写，并在五处做了不同的选择：

| | minimax-code 的 runaway-guard | 本例 |
| --- | --- | --- |
| 状态 | 宿主里的可变 Map | 不可变：`observeStep(旧状态, 这一步)` 返回新状态 |
| 失败放行 | 吞掉异常 | 照样放行，但记进 `failures`，一轮结束时交出去 |
| 会不会停 | 不会；交互模式没有步数上限 | 可选的硬上限 `maxSteps`，唯一会停的路径 |
| ABAB 交替 | 只观测；窗口从 ABAB 滑成 BABA 时会再记一次 | 只观测；交替对按无序对归一，一段交替只记一次 |
| 怎么调阈值 | 离线 replay 用生产的投影器 | JSONL 轨迹回放 CLI，退出码可以当回归闸门 |

```bash
npm start -- fixtures/loop-read.jsonl                                # 第 3 步提醒 action_repeat
npm start -- fixtures/flaky-network.jsonl                            # 第 3 步提醒 error_family（压过 action_repeat）
npm start -- fixtures/loop-read.jsonl --local fixtures/local.json    # 阈值 4
npm start -- fixtures/loop-read.jsonl --remote fixtures/remote-bad.json  # 坏字段忽略，maxSteps 5 生效
npm start -- fixtures/loop-read.jsonl --shadow                       # 只观测
npm start -- fixtures/poll.jsonl --json                              # 机器可读
npm test                                                             # 64 个用例
```

需要 Node ≥ 22.6（`--experimental-strip-types`）。没有依赖，不联网，不写文件。

退出码：`0` 整条轨迹没有提醒也没有停；`1` 有提醒或触到硬上限；`2` 用法、配置或轨迹有问题。0 和 1 分开，是为了写成「这条轨迹必须提醒」「这条不许提醒」两类回归。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 工具调用、结果、进度、信号、判定的类型；`REMINDABLE` 的顺序就是优先级 |
| `src/fingerprint.ts` | 键排序的稳定序列化（有字节、深度预算）+ HMAC-SHA256 |
| `src/errors.ts` | 错误族：错误码 > 类别关键词 > 截断原文；单条 rg / grep 没找到不算错误 |
| `src/detector.ts` | 五组连击 + 只观测的 ABAB，纯函数 |
| `src/reminder.ts` | 提醒文案，统一以「这不是规则，不要写进记忆」收尾 |
| `src/config.ts` | 本地 + 远端，远端优先；坏值算「没覆盖」 |
| `src/guard.ts` | 一轮一次、先占位再 steer、失败放行并记账、硬上限 |
| `src/replay.ts` | 逐行校验轨迹（坏一行整份拒绝，报行号）并回放 |
| `src/main.ts` | 命令行与退出码 |
| `fixtures/*.jsonl` | 七份轨迹：重复读、网络抖动、grep 没找到、无进展、轮询、ABAB、混合 |
| `test/*.test.ts` | `node:test` 用例 |

五类信号：

| 信号 | 键 | 提醒？ |
| --- | --- | --- |
| `no_progress` | 同一个 `target` 的 `state` 没变（参数可以每次都不同） | 是，优先级最高 |
| `error_family` | （错误族，动作指纹） | 是 |
| `action_repeat` | （工具，参数） | 是 |
| `polling_repeat` | （工具，参数，回答）——回答变了就不算空转 | 是，优先级最低 |
| `result_repeat` | （工具，是否出错，结果文本，错误码） | 只观测 |
| `abab` | 最近四批动作是 A B A B | 只观测 |

本例的简化：不排除被权限拦下的调用（minimax-code 排除）；进度 `progress` 由轨迹直接给出，不区分「可信来源」；轮询遇到中间穿插别的调用时直接清零，没有 minimax-code 那套「连续轮询」的细分；没有「验收子 agent 的轮次不提醒」这类宿主层规则。

三条经验：

1. **提醒先占位，再 steer。** 决定提醒的那一刻就把 `reminderAttempted` 设成真，再交给调用方注入。反过来写，steer 抛一次错，下一步又越线，就会再试一次——一轮一次的承诺在失败路径上破掉。测试里让 steer 每次都抛错，断言它只被调用一次。
2. **放行不等于没发生。** 守卫是第二道防线，不能因为自己坏了让一轮失败，所以要放行；但吞掉的异常要计数，一轮结束时随摘要交出去，否则「守卫一直没提醒」和「守卫一直在崩」看起来一模一样。
3. **测试要能抓住坏版本。** 写完测试后手动做了六处变异：不占位、打乱优先级、ABAB 不归一、放行不记账、坏值当覆盖、复合命令也豁免。每一处都至少让一个用例失败；有哪处换完全绿，就说明那条规则没被测到。
