---
layout: home

hero:
  name: Code Agent 实战
  text: 基于 Pi 从零构建
  tagline: 794 行内核撑起 6 万行产品层。这本书拆开它，然后告诉你另外五个团队在同样的问题上各自选了什么。
  image:
    src: /figures/cover.svg
    alt: 《Code Agent 实战：基于 Pi 从零构建》封面
  actions:
    - theme: brand
      text: 开始读
      link: /book/00-preface/ch00-1-about
    - theme: alt
      text: 三条阅读路径
      link: /book/00-preface/ch00-2-paths
    - theme: alt
      text: 完整目录
      link: /book/00-preface/cover

features:
  - icon: 🧩
    title: 机制与策略的分界线
    details: pi 明确不做权限、不做沙箱、不做 subagent —— 这些不是没做完，是论证过之后决定不做。读懂这批「不做」，才知道自己要补什么。
    link: /book/03-policy-layer/ch15-mechanism-not-policy
    linkText: 第 15 章
  - icon: 📍
    title: 每条结论都能追到行号
    details: 全书引用锁定在 pi b79e4cc8 (v0.84.4) 等 7 个 commit 上，不指向任何仓库的当前 HEAD。你 checkout 同一个 commit，看到的就是同一段代码。
    link: /research/BASELINE
    linkText: 基准版本表
  - icon: 🔬
    title: 三家衍生 + 两个独立对照
    details: 阶跃、MiniMax、月之暗面的代码衍生自 pi；DeepSeek 与智谱是自研内核。有对照组，才能分清哪个设计是团队的判断、哪个只是上游的路径依赖。
    link: /book/06-vendors/ch36-comparison
    linkText: 横向对照总表
  - icon: 🛠
    title: 每章都有能跑的最小实现
    details: 正文 CC BY-SA，但 examples/ 单独按 MIT 发布 —— ShareAlike 不该传染到你的代码库里。拿走就能用。
    link: https://github.com/xdimtech/code-agent-in-practice/tree/main/examples
    linkText: examples/
---

## 这本书替你回答什么

如果你正打算用 pi（或任何一个 Code Agent 内核）做产品，下面这些问题你迟早会遇到。括号里是对应章节。

| 你的问题 | 去哪一章 |
| --- | --- |
| 该不该用 pi，还是自己写 | [第 5 章 该不该用 Pi：横向对照](/book/01-choosing/ch05-should-you-use-pi) |
| 先跑起来看看 | [第 7 章 30 分钟跑通](/book/02-getting-started/ch07-hello-pi) |
| 怎么加一个自己的工具 | [第 10 章 写第一个工具](/book/02-getting-started/ch10-first-tool) |
| 怎么接自家的模型 | [第 11 章 接入自家模型](/book/02-getting-started/ch11-custom-provider) |
| 怎么塞进公司知识又不毁缓存 | [第 12 章 改造 system prompt 与上下文](/book/02-getting-started/ch12-context) |
| 它要执行 `rm -rf` 了，怎么拦 | [第 16 章 权限与确认](/book/03-policy-layer/ch16-permissions) |
| 它自己转起圈来了，怎么停 | [第 18 章 防死循环](/book/03-policy-layer/ch18-loop-guards) |
| 上线前还差什么 | [第 22 章 上线前必补清单](/book/04-shipping/ch22-preflight) |
| 改了提示词或工具，怎么知道没改坏 | [第 23 章 evals：怎么知道它做对了](/book/04-shipping/ch23-evals) |
| 主循环到底怎么转的 | [第 26 章 Agent Loop 三层切分](/book/05-internals/ch26-agent-loop) |
| 别人家是怎么做的 | [第六部分 厂商全景](/book/06-vendors/ch31-step) |

## 一条纪律

> 本书每一处 `file.ts:123` 都指向 [`research/`](/research/BASELINE) 里锁定 commit 的研究底稿，**不指向任何仓库的当前 HEAD**。

pi 每月 400–530 次提交。指向 `main` 的行号三周就会指到别的代码上。代价是这本书会落后于上游；收益是每一条都能被复现。

对一本讲工程判断的书，可复现比时效重要。

## 事实与推断分开写

全书沿用研究底稿的标注习惯，你要能随时判断哪些是可验证的、哪些是作者的判断：

> 【代码事实】`agent-loop.ts:252` 的 `shouldStopAfterTurn` 在 `packages/coding-agent/src/` 中零调用点。
>
> 【推断】这更像是遗漏而非设计 —— 相邻的 `uncaughtException` 路径被仔细处理过。
