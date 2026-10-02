# ch15-policy-layer

对应 [第 15 章 机制 vs 策略](../../book/03-policy-layer/ch15-mechanism-not-policy.md)。

pi 只给机制：执行前的 `tool_call` 钩子、用户 `!` 命令的 `user_bash` 钩子。这个例子在机制之上写一层最小的策略，用来看清「策略」这件事有多少细节：

- **一份策略接两条执行路径**：模型的工具调用和用户亲手敲的 `!` 命令走的是两个不同的事件，失败语义相反——`tool_call` 处理器抛错，工具不执行；`user_bash` 处理器抛错，错误被吞掉、命令照常在本机执行
- **命令分析给三种结果**：命中规则 / 看不全 / 普通。按词比对，不按整行字符串比对；遇到命令替换、内联代码、`xargs` 之类要到运行时才知道跑什么的写法，就说「看不全」，不当成普通命令放行
- **分层配置只许收紧**：用户自己的策略文件可以放松默认值；项目目录里的策略文件只能在此基础上收紧，放松请求被忽略并报出来
- **覆盖面检查**：每道闸门管得到哪些执行路径、出错时是关着失败还是开着失败

判断全在纯函数里；只有 `src/load.ts` 读磁盘（策略文件），不跟随符号链接。不执行任何命令。

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| 模型工具调用：处理器抛错 = 不执行 | `core/extensions/runner.ts:982-1003`；`agent/src/agent-loop.ts:617-665` | `src/host.ts` 的 `dispatchToolCall` |
| 用户 `!`：处理器抛错被吞掉，照常执行 | `core/extensions/runner.ts:1005-1030`；`modes/interactive/interactive-mode.ts:6470`、`:6516` | `src/host.ts` 的 `dispatchUserBash` |
| `user_bash` 的返回值没有 `block`，只能给一个顶替结果 | `core/extensions/types.ts:1137-1142` | `src/hooks.ts` 的 `userBashGate` |
| 示例扩展的危险命令正则、受保护路径子串匹配 | `examples/extensions/permission-gate.ts:11`、`:17`；`protected-paths.ts:11`、`:19` | `src/pi-gate.ts`（原样搬来当对照组） |
| sandbox 示例：项目配置后者覆盖，不看信任 | `examples/extensions/sandbox/index.ts:79-130` | `src/merge.ts` 的 `replaceMerge` 对 `tighten` |
| 四个示例扩展各管哪些路径 | `examples/extensions/` 下的 `permission-gate.ts`、`protected-paths.ts`、`sandbox/index.ts`、`gondolin/index.ts` | `src/coverage.ts` |

（pi 的路径以 `packages/coding-agent/` 为根，`agent/src/` 指 `packages/agent/src/`。）

```bash
npm start                                                    # 六段演示：两条路、失败语义、正则对分析器、配置合并、一份策略接两条路、覆盖面
npm start -- "rm -fr build"                                  # 按默认策略判断一条命令：放行 0、要问 1、拒绝 2
npm start -- "rm -fr build" --user --user-policy u.json --project-policy .agent/policy.json
npm test                                                     # 86 个用例
```

需要 Node ≥ 22.6，因为要用 `--experimental-strip-types` 直接运行 TypeScript，并用 `path.matchesGlob` 做路径匹配。没有依赖，所以不用 `npm i`。

策略文件是 JSON，四个键都可以不写：

```json
{ "mode": "ask", "writeRoots": ["."], "protectedPaths": [".env", "*.pem"], "gateUserCommands": true }
```

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 策略层的全部词汇：请求、决定、策略、默认值 |
| `src/shell.ts` | 把一行 shell 拆成简单命令；遇到运行时才知道的写法就停下 |
| `src/command.ts` | 命令三态分析：命中 / 看不全 / 普通 |
| `src/paths.ts` | 写入路径：必须在可写目录里、不能碰受保护路径；只做字面运算 |
| `src/decide.ts` | `decide`：策略 + 请求 → 放行 / 要问 / 拒绝，外加规则名 |
| `src/merge.ts` | 两种合并：后者覆盖、只许收紧 |
| `src/policy-file.ts` | 策略文件校验：拼错的键报错，不悄悄忽略 |
| `src/host.ts` | pi 两条分发路径的最小模型 |
| `src/hooks.ts` | 把 `decide` 接到两条路径上；没有界面时「要问」按拒绝处理 |
| `src/coverage.ts` | 闸门画像与缺口 |
| `src/pi-gate.ts` | pi 示例扩展里的判断逻辑，原样搬来当对照组 |
| `src/corpus.ts` | 13 条标了「实际会不会造成破坏」的命令 |
| `src/load.ts` | 读策略文件：只读普通文件，限制大小 |
| `src/report.ts`、`src/demo.ts`、`src/main.ts` | 输出、演示与命令行入口 |
| `src/*.test.ts` | `node:test` 用例 |

本例的简化：`shell.ts` 是词法近似，不是 bash 语法的实现；路径检查不解析符号链接，查和写之间的时间差也不处理（那是沙箱的活）；`host.ts` 只模拟两条分发路径的失败语义，不是真的 pi 进程。

写这层策略的三条经验：

1. **先数路径，再写规则。** 同一条 `rm -rf` 可以从模型的 `bash`、用户的 `!`、`write` 工具、扩展自己注册的工具进来。只挂在 `tool_call` 上的闸门，用户的 `!` 绕过它不需要任何技巧（演示第 1、6 段）。
2. **每个钩子的失败语义要分别确认。** `tool_call` 抛错是关着失败，`user_bash` 抛错是开着失败。接在 `user_bash` 上的处理器必须自己接住所有错误，把「策略出错」也变成一次拒绝（演示第 2、5 段）。
3. **「没有规则命中」不等于安全。** 命令分析至少要有三态；`npm run clean`、`./scripts/reset.sh` 这类命令靠静态规则永远看不出来，再往下只能靠隔离（演示第 3 段）。
