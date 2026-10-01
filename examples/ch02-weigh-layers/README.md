# ch02-weigh-layers

对应 [第 2 章 Pi 是什么：794 行内核 + 6 万行产品层](../../book/01-choosing/ch02-what-is-pi.md)。

按层称一个仓库的源码重量，或者把两个仓库逐层对照——回答「我的 fork 在哪一层偏离了上游，偏了多少」。零依赖。

行数口径与 [`research/BASELINE.md` § 行数怎么量](../../research/BASELINE.md#行数怎么量) 的 shell 管道逐条一致：只算 git 跟踪的 `.ts`/`.tsx`，路径须含 `/src/`，排除测试与 `examples/`。

```bash
npm i && npm start                                   # 称本书仓库自己（按目录自动分组）
npm start -- --preset pi /path/to/pi                 # 按 pi 的分层称一个仓库
npm start -- --preset pi /path/to/pi /path/to/fork   # 两个仓库逐层对照
npm test                                             # 18 个用例
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）和 `git`。要复现正文的数字，先把 pi 与 step-harness checkout 到 [版本表](../../research/BASELINE.md#版本表) 里的 commit。

| 文件 | 内容 |
| --- | --- |
| `src/filter.ts` | 口径：`isCountedSource`、与 `wc -l` 相同的 `countLines` |
| `src/layers.ts` | 有序前缀表归类、按层求和（纯函数） |
| `src/presets.ts` | pi 的分层预设：内核 / v2 harness / v1 运行时 / provider / TUI / 产品层 |
| `src/repo.ts` | 唯一碰外部世界的文件：找仓库根、`git ls-files`、读文件 |
| `src/report.ts` | 终端表格（全角字符按两格对齐） |
| `src/main.ts` | 命令行入口 |
| `src/*.test.ts` | `node:test` 用例 |

给自己的 fork 写预设：在 `src/presets.ts` 里加一张 `Layer[]`。**窄的层排前面**——归类按顺序取第一个命中的前缀，`packages/agent/src/agent-loop.ts` 必须排在 `packages/agent/` 之前。
