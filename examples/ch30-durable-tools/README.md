# ch30-durable-tools

对应 [第 30 章 v1/v2：Pi 的第二代运行时](../../book/05-internals/ch30-v2-runtime.md)。

把 pi v2 harness 的两条核心约定写成一个最小、可运行的工具批次，零依赖：

- **意图先于副作用落盘**：每个工具调用先写 `tool_started`（带 `replay` 声明），再执行，再写 `tool_settled`。对应 `packages/agent/src/harness/session/types.ts:150-161` 的 `ToolStartedRecord` 与规格 `packages/agent/docs/harness.md` §0.3「effect sandwich」。
- **恢复遇到协议不可能产生的状态，拒绝，不修复**：对应 `packages/agent/src/harness/reducer.ts:16-33` 与 `:312-390` 的 `validateRecordLog`。

```bash
npm i && npm start   # 在 rm 执行期间「杀进程」，重启后恢复；再喂一份损坏的日志
npm test             # 16 个用例
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。

| 文件 | 内容 |
| --- | --- |
| `src/journal.ts` | 记录类型、7 类损坏、`validate`（只拒绝不修复）、`restore`（折叠成每个调用的状态） |
| `src/recover.ts` | `drive`：正常执行与重启恢复共用一个函数；`effect_pending` 的 replay 策略 |
| `src/main.ts` | 演示 |
| `src/*.test.ts` | `node:test` 用例 |

与 pi 的差别：

1. **只做工具批次。** pi 的记录日志还覆盖队列、压缩、重试序号、延迟写入（12 类损坏），这里只保留与工具相关的 7 类。
2. **调用串行推进。** pi 规格允许同一批的多个调用同时处于 `effect_pending`（§3.2「Tool batch」），结果按调用顺序落盘；串行是为了让崩溃点一目了然。
3. **日志 + 折叠。** 这是 pi `b79e4cc8` 代码里 `reducer.ts` 的做法；同一版本的规格 `docs/harness.md` 已经改为「每步整体覆盖一个 `op.state` 寄存器、恢复只做点查」（§0.3、§4.4）。两种做法的取舍见正文 30.4 节。
