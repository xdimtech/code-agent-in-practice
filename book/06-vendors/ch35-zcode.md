# 第 35 章 智谱：ZCode（对照组）

> 基准：pi `b79e4cc8` (v0.84.4)　·　[版本表](../../research/BASELINE.md)　·　[参与指南](../../CONTRIBUTING.md)

**状态**：⛔ 阻塞：等各家拆解完成

## 本章回答

- 第二个**与 pi 零接触**的实现，独立面对同一批问题时选了什么
- 双栈形态（独立 agent CLI + server/web/desktop 应用栈经 RPC 复用）带来的约束与 pi 的单 CLI 形态有何不同
- 两个对照组**互相印证**的地方——那是最强的"标准解"证据；以及**互相矛盾**的地方——那说明这个问题根本没有标准解

## 素材来源

- [`research/zcode/`](../../research/zcode/) — 待完成
- **本章不做 pi diff**：`ZCode` 与 pi 零接触（全仓 grep `earendil` / `pi-tui` / `pi-mono` 零命中），没有 diff 可做

---

> ⚠️ **本章与第 34 章是一对，不是重复。** 两章都写"没有 pi 的前提下独立做了什么"，但对照角度不同：`deepseek-harness` 是**架构极端**（Cordis DI 容器上 315 个包）对 pi「794 行内核 + 6 万行单体产品层」的正面反例；`ZCode` 是**完全独立演化**——它连接触点都没有，也不走极细粒度插件化那条路。三个不同的架构答案摆在一起，才能看出哪一条是问题决定的、哪一条是选择决定的。

## 35.1 第二个对照组，它的角度和 DeepSeek 不同

<!-- 先立零接触的事实：全仓 grep earendil / pi-tui / pi-mono / pi-coding-agent 零命中；
     third-party/copied-components.json 只列 shadcn-ui 与 vercel/ai-elements。
     行号补在 research/zcode/ 落地之后。
     然后说清它和 ch34 的分工：ch34 是「另一个极端」，本章是「另一条路」 -->

## 35.2 它的架构选择：双栈与客户端矩阵

<!-- apps/zcode-cli/packages/* 是独立 agent CLI，packages/* 是 server/web/desktop 应用栈，
     经 rpc 层复用。这是五家里客户端矩阵最完整的一个（TUI + Web + Electron）。
     对照点：pi 只做一个 CLI，因此可以把状态留在进程里；ZCode 必须先把状态挪到能跨客户端复用的位置。
     形态决定架构，不是架构决定形态——这一节要把这条因果说清 -->

## 35.3 同一批策略问题，它的答案

<!-- 逐项回答第三部分的六个问题（权限 / 沙箱 / 防死循环 / 多 Agent /
     可观测性 / 凭据边界），与 pi 系、与 deepseek-harness 放同一张表。
     已知两处值得展开：
     1) 无 OS 级沙箱，仅权限模式 —— 与 pi「宁可不给也不给半吊子」的立场（security.md:35）
        结论一致而理由未必相同，值得对照；
     2) formal-proof 用 d3 对 run/queue/compact/goal 决策做状态机建模，
        另有 architecture-policy.yaml 自定义架构检查 —— 这是五家里唯一把
        loop 决策形式化的做法，对第 18 章（防死循环）是直接材料 -->

## 35.4 两个对照组一致与分叉的地方

<!-- 这一节是本章的收口，也是第 36 章总表的第二个输入：
     · 两个自研方都这么做 → 最强的标准解证据（比"三家衍生方趋同"强，因为无共享上游）
     · 两个自研方分叉 → 这个问题没有标准解，三家衍生方的趋同只是路径依赖
     注意不要在这里下"谁更好"的判断，只标出一致/分叉与各自的代价 -->

---

> ⚠️ **材料限制，写作时必须声明。** `ZCode` 每次 release 一个 squash commit，基准日全仓只有 3 个 commit / 2 个贡献者——**拿不到演进过程与设计讨论**，只能做静态代码拆解。这与第 34 章的 `deepseek-harness`（20,177 commit / 73 贡献者）形成材料上的不对称：那一章能写"他们是怎么走到这一步的"，本章只能写"他们现在是什么样"。
>
> 另有一处已知的文档滞后：`zcode-cua` 在文档里是 Computer Use 能力，运行时却是 fail-closed 占位，直接返回 "Computer Use is not available in this build"。这正是[方法论第一条](../../CONTRIBUTING.md)（以读源码为主、厂商文档为辅并交叉验证）的由来，本章会把它作为例子写出来。
