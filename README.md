# Code Agent 实战：基于 Pi 从零构建

> 一本讲怎么用 [pi](https://github.com/earendil-works/pi-mono) 做出能交付的 Code Agent 的书。
> 兼谈国内三家大模型厂商如何在同一个上游之上各自做产品，以及两个独立对照组的不同解法。

[![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC%20BY--SA%204.0-lightgrey.svg)](./LICENSE)

---

## 这本书解决什么问题

pi 的官方手册有 718 行，写得不差。这本书要补的是它不会写的三样东西：

1. **为什么这么设计** —— pi 明确不做权限系统、不做沙箱、不做 MCP、不做 subagent，而且**论证过为什么**。理解这些"不做"比理解"做了什么"更重要。
2. **边界在哪，你得自己补什么** —— pi 的立场是"提供机制，不提供策略"。这意味着每一个拿 pi 做产品的团队，都要自己补齐同一批东西。这本书把那批东西列清楚。
3. **别人已经怎么做了** —— 阶跃、MiniMax、月之暗面三家的 Code Agent 代码衍生自 pi，DeepSeek 与智谱则在没有 pi 的前提下独立面对了同一批问题。**同一个基座、三支独立团队、两个独立对照组、全部经受过真实生产压力**，这是一次难得的天然对照实验。

第 3 点是这本书最独有的部分。血缘关系（谁衍生、谁无关）见 [`research/BASELINE.md`](./research/BASELINE.md#血缘谁和-pi-是什么关系)——这是第三、六部分的前提，**不要跳过**。

---

## 给谁读

| 读者 | 从哪读 | 能拿到什么 |
| --- | --- | --- |
| **产品经理 / 技术决策者** | 第一部分 → 第三部分各章开头 | 能力边界、成本模型、该不该用 pi、各家投入了多少 |
| **开发者** | 第二部分 → 第三部分 → 第五部分 | 可跑的例子、任务→API 反查表、上线前必补清单 |
| **对 Agent 工程感兴趣** | 第五部分 → 第六部分 | 794 行内核怎么设计的、各家的选择差异说明了什么 |

三条路径详见 [0.2 三条阅读路径](./book/00-preface/ch00-2-paths.md)。

---

## 目录

完整目录见 [SUMMARY.md](./SUMMARY.md)。六个部分：

| 部分 | 主题 | 状态 |
| --- | --- | :---: |
| 一 | **选型**：该不该用 Pi | 🚧 |
| 二 | **上手**：让它跑起来 | 🚧 |
| 三 | **补齐策略层**：Pi 不给你的东西 ← 核心 | 🚧 |
| 四 | **交付**：上线前后 | 🚧 |
| 五 | **原理**：为什么这么设计 | ✅ |
| 六 | **厂商全景** | 🚧 |

> **当前状态：写作期。** 第五部分（第 26–30 章）与第 2、4、8 章已完成，附可运行的配套代码（`examples/`）；`research/pi/` 的 9 章拆解已完成并可读。
> 本书不等全书齐了再发——每完成一章即合入。

---

## 仓库结构

```
├── SUMMARY.md          # 完整目录
├── book/               # 正文
│   ├── 00-preface/
│   ├── 01-choosing/        第一部分 选型
│   ├── 02-getting-started/ 第二部分 上手
│   ├── 03-policy-layer/    第三部分 补齐策略层
│   ├── 04-shipping/        第四部分 交付
│   ├── 05-internals/       第五部分 原理
│   ├── 06-vendors/         第六部分 厂商全景
│   └── appendix/
├── examples/           # 可运行代码，目录名对应章号
└── research/           # 研究底稿（证据层）
    ├── BASELINE.md         ← 版本锁定表，先读这个
    ├── pi/                 ✅ 9 章完整拆解
    ├── step-code/          ⬜
    ├── minimax-code/       ⬜
    ├── kimi-code/          ⬜
    ├── deepseek-harness/   ⬜ 对照组
    └── zcode/              ⬜ 对照组
```

### `research/` 是什么

正文里每一处 `file.ts:123` 形式的引用，指向的都是 `research/` 里锁定版本的拆解，**而不是各仓库的当前 HEAD**。

pi 的提交节奏是每月 400–530 次。指向活仓库的行号三周就会烂掉。所以本书的做法是：研究在锁定的 commit 上进行，结论连同 commit 一起存进 `research/`，正文引用 `research/`。

代价是书会落后于上游；收益是**每一条都能被复现**。基准表见 [`research/BASELINE.md`](./research/BASELINE.md)。

---

## 在线阅读与本地构建

站点由 [VitePress](https://vitepress.dev) 构建，`SUMMARY.md` 是目录的唯一来源——`scripts/summary.mjs` 从它生成侧边栏，增删章节只需改那一个文件。

```bash
npm ci
npm run check     # 内链 + SUMMARY.md 覆盖检查
npm run build     # 产出 .vitepress/dist
npm run preview   # 本地看构建结果
npm run dev       # 开发服务器，带热更新
```

推送到 `main` 后由 GitHub Actions 构建并发布到 GitHub Pages（工作流见 `.github/workflows/deploy.yml`）。
首次启用需要在仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

站点默认挂在项目路径 `/code-agent-in-practice/` 下。换自定义域名时用 `DOCS_BASE=/ npm run build`。

> **一条安全提醒：`npm run dev` 只在你信任的网络环境下开。**
> 依赖链里的 esbuild ≤0.24.2 有一条开发服务器漏洞（[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)）：任意网站可以向本机的 dev server 发跨域请求并读取响应。它经 `vite` → `vitepress` → `vitepress-plugin-mermaid` 传递进来，上游暂无修复版本（`vitepress-plugin-mermaid` 的 peer 约束是 `vitepress: ^1.0.0`，而 VitePress 2.x 仍是 alpha，所以这里锁在 1.6.4 是当前正确的选择）。
>
> 影响面仅限开发服务器：CI 只跑 `npm run check` 与 `npm run build`，静态产物不受影响。开着 dev server 时不要同时浏览不可信站点即可。

---

## 研究方法

沿用 `research/pi/` 已经验证过的两条规则：

1. **以读源码为主，仓库自带文档为辅并交叉验证。** 厂商文档常滞后于代码，或把未实现的能力写成已实现。
2. **每个结论可追到文件行号**，并区分 **【代码事实】** 与 **【推断】**。

分析 pi 衍生仓库时额外一条：

3. **先与 pi 做 diff**，区分「上游设计」与「本家改造」，再给评价。

### 一条立场声明

第三、六部分分析的是五家真实公司的开源项目（全部为 MIT / Apache-2.0）。

**本书只做「谁选了什么、代价是什么」，不做「谁做得好」的评价性排名。** 这既是准确性要求，也因为读者需要的是判断依据，不是结论。

---

## 参与

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。三条硬约定：

1. 所有行号引用指向 `research/` 的版本快照，不指向活仓库；
2. 每章开头一行基准声明；
3. `examples/` 下每个目录都必须能跑起来。

---

## 许可

正文采用 [CC BY-SA 4.0](./LICENSE)；`examples/` 下的代码采用 MIT。

被分析的各仓库版权归其各自作者所有，引用遵循各自许可（pi 为 MIT，作者 Mario Zechner）。
