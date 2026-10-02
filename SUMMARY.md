# 目录

[封面](./book/00-preface/cover.md)

---

## 第 0 部分 · 导读

- [0.1 这本书是什么，给谁](./book/00-preface/ch00-1-about.md)
- [0.2 三条阅读路径](./book/00-preface/ch00-2-paths.md)
- [0.3 基准版本声明](./research/BASELINE.md)

---

## 第一部分 · 选型：该不该用 Pi

- [第 1 章 Code Agent 是什么](./book/01-choosing/ch01-what-is-code-agent.md)
- [第 2 章 Pi 是什么：794 行内核 + 6 万行产品层](./book/01-choosing/ch02-what-is-pi.md)
- [第 3 章 四种形态选哪种](./book/01-choosing/ch03-four-modes.md)
- [第 4 章 能力边界：可以承诺什么](./book/01-choosing/ch04-capability-boundary.md)
- [第 5 章 该不该用 Pi：横向对照](./book/01-choosing/ch05-should-you-use-pi.md)
- [第 6 章 成本与投入](./book/01-choosing/ch06-cost-and-effort.md)

---

## 第二部分 · 上手：让它跑起来

- [第 7 章 30 分钟跑通](./book/02-getting-started/ch07-hello-pi.md)
- [第 8 章 扩展系统的心智模型](./book/02-getting-started/ch08-extension-model.md)
- [第 9 章 任务 → API 反查表](./book/02-getting-started/ch09-api-lookup.md)
- [第 10 章 写第一个工具](./book/02-getting-started/ch10-first-tool.md)
- [第 11 章 接入自家模型](./book/02-getting-started/ch11-custom-provider.md)
- [第 12 章 改造 system prompt 与上下文](./book/02-getting-started/ch12-context.md)
- [第 13 章 打包与分发](./book/02-getting-started/ch13-packaging.md)
- [第 14 章 调试与排障](./book/02-getting-started/ch14-debugging.md)

---

## 第三部分 · 补齐策略层：Pi 不给你的东西

- [第 15 章 机制 vs 策略：读懂 Pi 的设计立场](./book/03-policy-layer/ch15-mechanism-not-policy.md)
- [第 16 章 权限与确认](./book/03-policy-layer/ch16-permissions.md)
- [第 17 章 沙箱与隔离](./book/03-policy-layer/ch17-sandboxing.md)
- [第 18 章 防死循环](./book/03-policy-layer/ch18-loop-guards.md)
- [第 19 章 多 Agent：架构分水岭](./book/03-policy-layer/ch19-multi-agent.md)
- [第 20 章 可观测性与遥测](./book/03-policy-layer/ch20-observability.md)
- [第 21 章 凭据与数据边界](./book/03-policy-layer/ch21-credentials.md)

---

## 第四部分 · 交付：上线前后

- [第 22 章 上线前必补清单](./book/04-shipping/ch22-preflight.md)
- [第 23 章 evals：怎么知道它做对了](./book/04-shipping/ch23-evals.md)
- [第 24 章 版本与升级策略](./book/04-shipping/ch24-upstream-strategy.md)
- [第 25 章 合规与审计边界](./book/04-shipping/ch25-compliance.md)

---

## 第五部分 · 原理：为什么这么设计

- [第 26 章 Agent Loop 三层切分](./book/05-internals/ch26-agent-loop.md)
- [第 27 章 双队列：steering 与 follow-up](./book/05-internals/ch27-steering.md)
- [第 28 章 上下文工程四条硬规则](./book/05-internals/ch28-context-engineering.md)
- [第 29 章 工具执行的四个坑](./book/05-internals/ch29-tool-execution.md)
- [第 30 章 v1/v2：Pi 的第二代运行时](./book/05-internals/ch30-v2-runtime.md)

---

## 第六部分 · 厂商全景：三家衍生 + 两个对照

- [第 31 章 阶跃星辰：Step-Code](./book/06-vendors/ch31-step.md)
- [第 32 章 MiniMax：minimax-code](./book/06-vendors/ch32-minimax.md)
- [第 33 章 月之暗面：kimi-code](./book/06-vendors/ch33-kimi.md)
- [第 34 章 DeepSeek：deepseek-harness（对照组）](./book/06-vendors/ch34-deepseek.md)
- [第 35 章 智谱：ZCode（对照组）](./book/06-vendors/ch35-zcode.md)
- [第 36 章 横向对照总表](./book/06-vendors/ch36-comparison.md)
- [第 37 章 从各家的选择里能学到什么](./book/06-vendors/ch37-lessons.md)

---

## 附录

- [附录 A 基准版本与 HEAD 表](./research/BASELINE.md)
- [附录 B 扩展事件全表](./book/appendix/a-extension-events.md)
- [附录 C Provider 清单](./book/appendix/b-providers.md)
- [附录 D 下游探针清单](./book/appendix/c-probes.md)
- [附录 E 术语表](./book/appendix/d-glossary.md)

---

## 研究底稿（证据层）

正文的全部行号引用都指向这里。

- [研究基准](./research/BASELINE.md)
- [pi 完整拆解（9 章）](./research/pi/)
- [Step-Code](./research/step-code/) — 待完成
- [minimax-code](./research/minimax-code/) — 待完成
- [kimi-code](./research/kimi-code/) — 待完成
- [deepseek-harness（对照组）](./research/deepseek-harness/) — 待完成
- [ZCode（对照组）](./research/zcode/) — 待完成
