# ch04-capability-audit

对应 [第 4 章 能力边界：哪些是没做，哪些是决定不做](../../book/01-choosing/ch04-capability-boundary.md)。

按一份能力清单审计一个仓库，把每项能力归进五种状态之一，每个结论都附 `file:line` 证据；给两个仓库时逐项对照——回答「我的 fork 补了上游哪些能力、文档有没有跟上」。零依赖。

| 状态 | 判据 |
| --- | --- |
| 有 | 实现探针命中；清单要求检查接线时，接线探针也命中 |
| 未接线 | 实现探针命中，接线探针全部落空——契约在，没有调用点 |
| 声明过时 | 实现探针命中，文档里的「不做」声明也还在 |
| 决定不做 | 实现探针落空，文档里有书面的「不做」声明 |
| 没做 | 两样都没有 |

```bash
npm i && npm start                                       # 审计本书仓库自己（不是 agent 产品，24 项全是「没做」）
npm start -- /path/to/pi                                 # 按内置的 pi 清单审计 pi
npm start -- /path/to/pi /path/to/fork                   # 两个仓库逐项对照
npm start -- --manifest my.json /path/to/repo            # 换成自己的清单
npm test                                                 # 23 个用例
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）和 `git`。要复现正文的数字，先把 pi 与 step-harness checkout 到 [版本表](../../research/BASELINE.md#版本表) 里的 commit。

| 文件 | 内容 |
| --- | --- |
| `src/manifest.ts` | 清单的形状（`Probe` / `Capability`）与校验——用户给的 JSON 是外部输入 |
| `src/classify.ts` | 五种状态的判定（纯函数）、按清单逐项取证 |
| `src/pi-manifest.ts` | pi 的 24 项能力清单 |
| `src/probe.ts` | 唯一碰外部世界的文件：找仓库根、跑 `git grep`、解析输出 |
| `src/report.ts` | 终端表格（全角字符按两格对齐）、引用挑选 |
| `src/main.ts` | 命令行入口 |
| `src/*.test.ts` | `node:test` 用例 |

写清单的三条经验：

1. **探针是线索，不是结论。** 一个宽泛的 `background` 会命中子 agent 的 `run_in_background`，那不是后台 bash。把搜索范围收窄到真正该出现的目录。
2. **最具体的探针写在前面。** `present` 按顺序试，第一个有命中的提供证据；先写「工具注册」这类强证据，再写宽泛的兜底。
3. **工具会搜到自己。** 清单里写满了探针字符串。被审计的仓库包含本工具时，工具会自动排除自己所在的目录。
