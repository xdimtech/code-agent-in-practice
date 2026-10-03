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
| [`ch03-modes/`](./ch03-modes/) | 第 3 章 | 四种形态选哪种：照抄 pi 的形态判定、五种形态的契约与换形态代价、严格 JSONL 分帧与 U+2028、真起假 RPC 子进程看对话框挂住、检查 json / rpc 录下的输出，零依赖 |
| [`ch04-capability-audit/`](./ch04-capability-audit/) | 第 4 章 | 按能力清单把仓库归进五种状态，附 `file:line` 证据，与 fork 逐项对照，零依赖 |
| [`ch08-extension-host/`](./ch08-extension-host/) | 第 8 章 | 按 pi 心智模型写的扩展宿主：工厂函数、注册即提交、失败回滚、通知容错、拦截 fail-closed、保留键，零依赖 |
| [`ch09-api-lookup/`](./ch09-api-lookup/) | 第 9 章 | 扩展 API 反查：按任务找事件或 API、36 个事件的卡片、照 pi runner 写的 12 种合并方式模拟器、记录事件顺序的扩展与顺序检查器，零依赖 |
| [`ch11-custom-provider/`](./ch11-custom-provider/) | 第 11 章 | provider 注册表与 OpenAI 兼容流式适配器：四层合成、校验与回退、compat 猜测、流式拼装、钩子契约检查，零依赖 |
| [`ch12-context/`](./ch12-context/) | 第 12 章 | system prompt 与上下文注入：AGENTS.md 发现、Skills 两段式注入与信任门、扩展注入链、前缀缓存模拟，零依赖 |
| [`ch13-package-gate/`](./ch13-package-gate/) | 第 13 章 | 打包与分发：清单与约定目录、过滤四步、五级优先级、包去重、装前检查、`--ignore-scripts` 加白名单的安装闸门，零依赖 |
| [`ch14-session-reader/`](./ch14-session-reader/) | 第 14 章 | 调试与排障：读会话 JSONL（坏行、分支、压缩、花费）、按严重程度诊断、会话到请求的投影、provider 请求录制与回放、自检（doctor）、调试变量检查、分享前脱敏，零依赖 |
| [`ch15-policy-layer/`](./ch15-policy-layer/) | 第 15 章 | 机制之上的最小策略层：两条执行路径的失败语义、命令三态分析（命中 / 看不全 / 普通）、写入路径规则、分层配置只许收紧、各闸门的覆盖面检查，零依赖 |
| [`ch24-upgrade-triage/`](./ch24-upgrade-triage/) | 第 24 章 | 升级前的四个检查：CHANGELOG 区间里的破坏性变更、vendor 标记、补丁台账体检、基线 / 我们 / 上游新版三方分诊并与台账对账，零依赖 |
| [`ch25-audit-log/`](./ch25-audit-log/) | 第 25 章 | 合规与审计边界：检查 pi 会话能证明什么、带哈希链（sha256 / HMAC）与外部锚点的只追加审计日志、停在第一处断裂的逐行校验、记下的参数与执行的参数对照、写不进去就拦下工具调用的 pi 扩展，零依赖 |
| [`ch26-minimal-loop/`](./ch26-minimal-loop/) | 第 26 章 | 按 pi 三层切分写的最小 Agent 循环，零依赖 |
| [`ch29-tool-batch/`](./ch29-tool-batch/) | 第 29 章 | 工具批次执行与按字节安全截断，零依赖 |
| [`ch30-durable-tools/`](./ch30-durable-tools/) | 第 30 章 | 意图—结算日志、重启恢复、replay 策略、损坏即拒绝，零依赖 |

