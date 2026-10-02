# ch14-session-reader

对应 [第 14 章 调试与排障](../../book/02-getting-started/ch14-debugging.md)。

pi 没有日志模块和日志级别，也没有 `PI_DEBUG`、请求录制和 `doctor`。排障能依靠的是会话 JSONL、七个散落在源码各处的调试环境变量、隐藏命令 `/debug`，以及两个扩展钩子 `before_provider_request` / `after_provider_response`。这个例子把它们做成工具：

- **读会话文件**：坏行照样跳过，但报出行号；把流水还原成树，分清当前对话、被放弃的分支、压缩后模型实际看到的上下文；按 pi 的口径算花费，并拆开来看这笔钱花在哪里；按高 / 中 / 提示列出排障时该先看的地方，被放弃的分支也一起诊断
- **检查调试变量**：同样写 `true`，有的变量生效有的不生效；哪些会把屏幕内容落盘；哪个会和 `/debug` 写同一个文件
- **分享前脱敏**：工具参数里的密钥遮掉，内联的图片拿掉，另写一份副本，不覆盖原文件
- **会话 ≠ 请求**：把上下文投影成模型实际收到的消息序列——压缩摘要和 `!` 命令变成 user 消息、出错的助手消息整条丢掉、没结果的工具调用补一条假结果、图片换占位
- **录制与回放**：一个 pi 扩展把每次 provider 请求录成「磁带」（落盘前脱敏，文件 `0600`）；读磁带时和会话对一遍，指出磁带自己漏掉的地方；回放时比对指纹，停在第一处差异并给出 JSONPath
- **自检**：pi 没有 `doctor`，这里补一个——Node 版本、配置目录、`auth.json` 权限、`models.json` / `settings.json` 能否解析（后者不许注释）、遗留的调试日志、开着的调试变量

规则部分全是纯函数。碰磁盘的只有两处：`src/load.ts`（读会话和磁带前检查是不是普通文件、有多大；写副本用 `wx` 和 `0600`；自检时 `auth.json` 只看权限不读内容），以及 `extension/record-provider.ts` 的追加写。不连网络。演示里的磁带是按演示会话推出来的，不是真实录制；扩展只用假的 `pi` 对象测过，没有接到真实的 pi 上跑过。

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| 第一条有效行必须是会话头，否则拒绝打开 | `core/session-manager.ts:548-553`、`:903-907` | `src/jsonl.ts` |
| 坏行静默跳过 | `core/session-manager.ts:503-511` | `src/jsonl.ts`（照样跳过，但记下来） |
| 叶子 = 文件最后一条；从叶子沿 `parentId` 回走就是当前对话，回走没有防环 | `core/session-manager.ts:964-967`、`:334-360` | `src/tree.ts` |
| 上下文 = 最近一次压缩的摘要 + 保留的尾巴 + 之后的条目 | `core/session-manager.ts:418-454` | `src/tree.ts` 的 `contextEntries` |
| 花费在收到回复时算好、写死在消息里 | `packages/ai/src/models.ts:878-898` | `src/usage.ts` 的 `calculateCost`（返回新对象） |
| `/session` 把全部条目加起来；按 `responseModel` 归属 | `core/agent-session.ts:3318-3373`、`core/usage-totals.ts:37-70` | `src/usage.ts` 的 `sumEntries`、`breakdown` |
| 七个调试变量各自的生效规则和输出位置 | 见 `src/debug-vars.ts` 每一行的 `source` | `src/debug-vars.ts` |
| 会话目录名和文件名的编码 | `core/session-manager.ts:476-481`、`:953-954` | `src/locate.ts` |
| `!` 命令的完整输出只在截断时写临时文件 | `core/bash-executor.ts:113-128` | `src/diagnose.ts` 的 `bash:truncated` |
| 会话消息转成模型消息：`!` 命令、压缩摘要、分支摘要、扩展消息都变成 user | `core/messages.ts:148-195` | `src/wire.ts` |
| 出错 / 中断的助手消息不发；孤立的工具调用补 `No result provided`；不支持图片时换占位 | `packages/ai/src/api/transform-messages.ts:189-197`、`:158-180`、`:219-220`、`:12-36` | `src/wire.ts` |
| 请求体组装完、发出前触发 `before_provider_request`，返回非 `undefined` 就替换请求体 | `core/sdk.ts:343-349`、`core/extensions/runner.ts:1066-1098` | `src/recorder.ts`（永远返回 `undefined`） |
| 收到响应头后触发 `after_provider_response`；SDK 重试路径上失败的响应不触发 | `core/sdk.ts:350-360`、`packages/ai/src/api/anthropic-messages.ts:575-583`、`packages/ai/src/utils/provider-retry.ts:105-125` | `src/tape-check.ts` 的 `tape:no-response` |
| 压缩和分支摘要直接调 `streamFunction`，不经过钩子 | `core/compaction/compaction.ts:565`、`core/agent-session.ts:1917`、`:3207` | `src/tape-check.ts` 的 `tape:summaries` |
| `models.json` 去注释再解析，`settings.json` 不去；解析失败整份设置作废 | `core/model-config.ts:264`、`core/settings-manager.ts:407`、`:416-420` | `src/doctor.ts` |
| `auth.json` 用 `0600` 创建，会话文件和目录不指定权限 | `core/auth-storage.ts:24-25`、`core/session-manager.ts:486`、`:1031` | `src/doctor.ts` |

（pi 的路径以 `packages/coding-agent/src/` 为根，另有说明的除外。）

```bash
npm start                                         # 十一段演示：坏行、树、时间线、花费、诊断、调试变量、脱敏、投影、录制、回放、自检
npm start -- ~/.pi/agent/sessions/--x--/<文件>.jsonl   # 检查一个真实会话；有「高」级发现时退出码为 1
npm start -- <会话>.jsonl --redact shared.jsonl   # 另写一份脱敏副本，目标已存在就报错
npm start -- <会话>.jsonl --tape /tmp/pi-tape.jsonl   # 连同磁带一起检查：磁带来自别的会话时退出码为 1
npm start -- --env                                # 七个调试变量的说明，以及当前环境里设了哪些、是否生效
npm start -- --doctor                             # 自检本机的 pi 环境；有「失败」时退出码为 1
npm test                                          # 96 个用例
```

录制要在 pi 里加载扩展（`--tape` 是扩展注册的旗标，不给就什么都不录）：

```bash
pi -e ./extension/record-provider.ts --tape /tmp/pi-tape.jsonl
```

需要 Node ≥ 22.6，因为要用 `--experimental-strip-types` 直接运行 TypeScript。没有依赖，所以不用 `npm i`。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 会话文件里用得到的类型子集，字段名与 pi 一致 |
| `src/jsonl.ts` | 解析：会话头、坏行与原因、是否需要迁移、末行是否缺换行 |
| `src/tree.ts` | 叶子、当前对话、被放弃的分支、压缩后的上下文；重复 id、悬空父条目、环 |
| `src/usage.ts` | 用量累加、按模型拆分、计价公式（不改入参） |
| `src/diagnose.ts` | 诊断：结构、停止原因、工具调用、被放弃的分支、压缩 |
| `src/timeline.ts` | 一行一条的时间线 |
| `src/debug-vars.ts` | 七个调试变量的表与生效检查 |
| `src/redact.ts` | 密钥与图片的脱敏 |
| `src/locate.ts` | 会话文件的目录名与文件名 |
| `src/wire.ts` | 上下文 → 模型收到的消息序列，以及哪些条目不发 |
| `src/recorder.ts` | 磁带记录的格式、响应头白名单、键排序指纹、录制器（写盘由调用方注入） |
| `src/tape.ts` | 读磁带：逐行校验，按 `seq` 归成一次次请求，请求体形状 |
| `src/replay.ts` | 回放：指纹比对、第一处差异的 JSONPath |
| `src/tape-check.ts` | 磁带和会话对一遍：别的会话、对不上的叶子、没响应头、摘要请求不在磁带里 |
| `src/doctor.ts` | 自检：一组纯函数检查，输入是环境快照 |
| `src/load.ts` | 读会话和磁带（不跟随符号链接，限 64 MiB），写脱敏副本，给自检拍环境快照 |
| `src/demo-tape.ts` | 演示用磁带：按演示会话推出每次请求的请求体 |
| `src/report.ts`、`src/demo.ts`、`src/main.ts` | 输出格式、十一段演示、命令行入口 |
| `extension/record-provider.ts` | pi 扩展：注册 `--tape`，在三个事件上调录制器，追加写，文件 `0600` |
| `demo/session.jsonl` | 演示用会话：一个坏行、一条被放弃的分支、一次模型切换、一次压缩、一张图、一个没有结果的工具调用 |
| `src/*.test.ts`、`extension/*.test.ts` | `node:test` 用例；`src/fixtures.ts` 是条目构造器；扩展用一个假的 `pi` 对象测 |

本例的简化：v1 / v2 文件只提示「会被迁移」，不做迁移本身；投影只模拟到 pi 自己的两道转换，各 provider 的最后一次序列化不模拟（要看最终形态就看磁带）；回放只做比对，把命中的回答喂给 faux provider 那一半没有做；`branch_summary`、`custom_message` 这些条目只在时间线里显示，不参与上下文重建的细节；脱敏规则是启发式的，挡不住所有格式，发出去之前还是要人看一遍。

排障的三条经验：

1. **先读会话文件，再猜。** pi 没有日志，但每一次请求、每一个工具调用和结果、每一次模型切换和压缩都在 JSONL 里。不过 pi 读它时会静默跳过坏行，你看到的对话可能少了几条（演示第 1、5 段）。
2. **文件是流水，会话是树。** 当前对话只是从最后一条往回走的那条路；被放弃的分支还在文件里，也算进了花费，而用户往回退往往正是因为那边出了事（演示第 2、4、5 段）。
3. **调试开关各写各的。** 只认 `"1"` 的、认 `1/true/yes` 的、非空就算的混在一起；其中两个会把屏幕内容写到磁盘上。打开之前查一下，用完删掉（演示第 6 段）。
4. **会话里写的不是模型收到的。** 系统提示词和工具定义根本不在会话里；在会话里的也要过两道转换。要回答「模型到底看到了什么」，只能在发出去的那一刻录下来，而录下来的东西比会话更敏感（演示第 8、9 段）。
5. **先排除环境，再怀疑模型。** Node 版本、配置目录指错、`settings.json` 里一行注释，都会让 pi 表现得「不对」，却不会在对话里留下任何痕迹（演示第 11 段）。
