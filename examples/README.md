# examples

每个目录对应正文一章，目录名带章号。

```
examples/ch10-first-tool/
├── README.md        # 这个例子演示什么、对应哪一章
├── package.json     # 依赖锁定精确版本
└── src/
```

**硬性验收标准**：`npm i && npm start` 在干净环境下成功。

这是本书与一份拆解报告的本质区别 —— 拆解引用代码是为了举证，书引用代码是为了给模板。

本目录下代码采用 [MIT](https://github.com/xdimtech/code-agent-in-practice/blob/main/examples/LICENSE)（与正文的 CC BY-SA 4.0 不同，方便你直接抄进自己的项目）。

## 目录

| 目录 | 对应章节 | 内容 |
| --- | --- | --- |
| [`ch02-weigh-layers/`](./ch02-weigh-layers/) | 第 2 章 | 按层称一个仓库的源码重量，与 fork 逐层对照，零依赖 |
| [`ch04-capability-audit/`](./ch04-capability-audit/) | 第 4 章 | 按能力清单把仓库归进五种状态，附 `file:line` 证据，与 fork 逐项对照，零依赖 |
| [`ch26-minimal-loop/`](./ch26-minimal-loop/) | 第 26 章 | 按 pi 三层切分写的最小 Agent 循环，零依赖 |
| [`ch29-tool-batch/`](./ch29-tool-batch/) | 第 29 章 | 工具批次执行与按字节安全截断，零依赖 |
| [`ch30-durable-tools/`](./ch30-durable-tools/) | 第 30 章 | 意图—结算日志、重启恢复、replay 策略、损坏即拒绝，零依赖 |

