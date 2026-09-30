# 第 34 章 DeepSeek：deepseek-harness（对照组）

> 基准：pi `b79e4cc8` (v0.84.4)　·　[版本表](../../research/BASELINE.md)　·　[参与指南](../../CONTRIBUTING.md)

**状态**：⛔ 阻塞：等各家拆解完成

## 本章回答

- 一个**不用 pi** 的团队，独立面对同一批问题时选了什么
- 极细粒度插件化（Cordis DI 容器 + 315 个包）与 pi「794 行内核 + 6 万行单体产品层」的正面对照
- 哪些设计三家衍生方与它**一致** → 那是标准解；哪些**分叉** → 那是 pi 的路径依赖

## 素材来源

- [`research/deepseek-harness/`](../../research/deepseek-harness/) — 待完成
- **本章不做 pi diff**：`deepseek-harness` 与 pi 无功能依赖，证据与行号见该目录 README

---

> ⚠️ **本章与第 31–33 章的结构不同。** 那三章写的是「在 pi 上改了什么」，本章与下一章写的是「在没有 pi 的前提下独立做了什么」。不要套用 diff 模板——这里没有 diff。

## 34.1 它为什么是对照组而不是第四家

<!-- @earendil-works/pi-ai 确实在源码里，但只挂在默认休眠的可选第三方 provider
     适配器上，不在 DeepSeek 自家模型路径上。行号见 research/deepseek-harness/README.md。
     这一节必须先把这件事说清楚，否则读者会以为本章在讲一个 pi 衍生实现 -->

## 34.2 它的架构选择：315 个包

<!-- Cordis DI 容器，compaction / context / spill / guard / subagent 各自成包。
     与 pi 的对照点：pi 把复杂度集中在产品层，它把复杂度摊进了包边界 -->

## 34.3 同一批策略问题，它的答案

<!-- 逐项回答第三部分的六个问题（权限 / 沙箱 / 防死循环 / 多 Agent /
     可观测性 / 凭据边界），与 pi 系放同一张表 -->

## 34.4 与三家衍生方的异同说明了什么

<!-- 一致 → 标准解，照抄不会错
     分叉 → pi 的路径依赖，你有得选
     这一节是整个第六部分方法论上的收口，第 36 章的总表由此展开 -->
