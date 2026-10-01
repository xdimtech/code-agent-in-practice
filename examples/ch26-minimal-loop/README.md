# ch26-minimal-loop

对应 [第 26 章 Agent Loop 三层切分](../../book/05-internals/ch26-agent-loop.md)。

按 pi `runLoop`（`packages/agent/src/agent-loop.ts:156-273`）的结构写的最小循环，零依赖，用脚本化的假模型代替真实 API，**不需要任何 key**。

```bash
npm i && npm start   # 跑一遍两轮工具调用 + 一条 follow-up
npm test             # 6 个用例，覆盖三个出口、快照不可变、未知工具
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。

| 文件 | 内容 |
| --- | --- |
| `src/loop.ts` | 循环本体，对应 pi 的 L1 |
| `src/scripted-model.ts` | 按顺序吐预设回复的假模型 |
| `src/main.ts` | 演示，带一个「最多 5 轮」的停止策略 |
| `src/loop.test.ts` | `node:test` 用例 |

与 pi 的差别：省掉了流式输出、并行工具执行、`prepareNextTurn`、steering 的出队模式——这些分别在第 27、29 章展开。
