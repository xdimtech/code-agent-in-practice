# ch33-repeat-breaker

对应 [第 33 章 月之暗面：kimi-code](../../book/06-vendors/ch33-kimi.md)。

kimi-code 在 pi 的「零防死循环」上补了一个**会真停**的重复调用断路器：同一个调用（工具名 + 规范化参数）连续出现 3 / 5 / 8 次，把逐级加重的提醒贴在工具结果后面；第 12 次照样执行，然后结束这一轮，再给一步「只许写字」的交接——这一步里模型再调工具，调用一律否决。同一步里键相同的调用只执行第一个，其余共享它的结果，但都计入连续次数。这个例子按同样的规则重写，并在四处做了不同的选择：

| | kimi-code 的 `toolDedupeService` | 本例 |
| --- | --- | --- |
| 状态 | 服务里的可变字段，按步、按轮重置 | 不可变：`planStep(旧状态, 调用)` → `settleStep(计划, 输出)` 返回新状态 |
| 同一步的重复 | 挂一个 deferred Promise，等原调用的结果 | 同步复制原调用已经结算好的结果（含提醒） |
| 遥测 | 写进遥测管线，副作用 | 作为 `events` 返回，由调用方决定怎么用 |
| A B 交替 | 每次换键计数归 1，逃得过；只记 `turn_repeat` 遥测 | 加一个交替检测：尾巴上按周期 2–3 原样重复 3 遍就提醒一次；`--kimi` 关掉它，行为与原版一致 |
| 怎么验证 | 单元测试 | JSONL 轨迹回放 CLI，退出码可以当回归闸门 |

```bash
npm start -- fixtures/loop-read.jsonl              # 3 / 5 / 8 提醒，12 停，13 交接（文字）
npm start -- fixtures/handoff-veto.jsonl           # 交接步里又调工具 → 否决
npm start -- fixtures/same-step.jsonl              # 同一步 3 个相同调用，只执行 1 个；下一步就是第 4 次
npm start -- fixtures/abab.jsonl                   # 交替：本例提醒
npm start -- fixtures/abab.jsonl --kimi            # 交替：原版规则，不干预，退出 0
npm start -- fixtures/parallel-pair.jsonl --kimi   # 每步并行 [A, B]：原版同样逃过
npm start -- fixtures/truncated.jsonl              # 截断在不同位置的参数不会撞成同一个键
npm start -- fixtures/loop-read.jsonl --max-steps 12   # 交接步绕过步数上限
npm start -- fixtures/two-turns.jsonl --json       # 机器可读
npm test                                           # 56 个用例
```

需要 Node ≥ 22.6（`--experimental-strip-types`）。没有依赖，不联网，不写文件。

退出码：`0` 整条轨迹没有提醒、没有停、没有否决；`1` 有任何一种干预；`2` 用法、阈值或轨迹有问题。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 调用、输出、结算结果、动作、交接阶段、事件的类型 |
| `src/key.ts` | 键排序的稳定序列化；参数解析失败时用原始字符串当键 |
| `src/reminders.ts` | 三级提醒、交接否决、交替提醒的文案（意译 kimi-code 的英文原文） |
| `src/config.ts` | 阈值 3 / 5 / 8 / 12、交替检测参数、可选的步数上限；校验严格递增 |
| `src/cycle.ts` | 交替检测：尾巴按周期原样重复几遍，一组里不能全是同一个键 |
| `src/breaker.ts` | 断路器本体：计划（执行 / 共享 / 否决）与结算（提醒、真停、交接） |
| `src/turn.ts` | 把一串步切成轮：文字结束、断路器结束、步数上限、轨迹中断 |
| `src/replay.ts` | 逐行校验轨迹（坏一行整份拒绝，报行号）并回放、汇总 |
| `src/main.ts` | 命令行与退出码 |
| `fixtures/*.jsonl` | 八份轨迹：重复读、交接否决、同一步重复、交替、并行成对、截断、两轮、正常会话 |
| `test/*.test.ts` | `node:test` 用例 |

轨迹的一行是一步：

```json
{"calls":[{"id":"c1","tool":"Read","args":{"path":"src/app.ts"}}],"results":[{"id":"c1","text":"…","isError":false}]}
```

`args`（已解析的对象）和 `arguments`（模型给的原始字符串）二选一；`calls` 为空就是模型只写了字，这一轮结束。

本例的简化：没有「原调用的结果丢了」那条路径（kimi-code 用一条固定文案兜底）；交接被丢弃只在轨迹提前结束时出现，没有模拟用户中断；不处理超大结果的落盘。

三条经验：

1. **同一步的重复要计数。** 模型一步里并行发三个一模一样的 `Bash npm test`，只执行一个是省钱；但如果计数也只算一个，「每步发三个」的打转就要多走三倍的步数才会被抓到。kimi-code 的 `endStep` 把重复的也走一遍计数，本例照做，`same-step.jsonl` 的第 2 步因此已经是第 4 次。
2. **真停之后留一步，而且这一步要绕过步数上限。** 断路器停下时，用户最需要的是一段「卡在哪、试过什么」的交代。如果交接步也受步数上限管，恰好在上限附近停下的会话就什么都拿不到。测试里把上限设成 12，断言第 13 步的交接照样发生。
3. **测试要能抓住坏版本。** 写完测试后做了八处变异：同一步的重复照样执行、重复不计数、第 12 次不停、交接不否决、交接不绕过上限、解析失败按 `{}` 算键、交替提醒每步都贴、真停那一步也叠交替提醒。每一处都至少让一个用例失败（分别 5 / 5 / 14 / 7 / 1 / 2 / 2 / 1 个）。
