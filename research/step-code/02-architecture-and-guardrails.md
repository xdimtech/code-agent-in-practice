# 2. 架构分层与守卫体系

> 对照基准：[pi 第 2 章](../pi/02-architecture-and-guardrails.md)。pi 那一章的 2.2 节标题是「没有机器强制的架构规则」——这正是 Step-Code 改得最多的地方。

## 2.1 包结构：改名、搬家、加一层壳

【代码事实】构建顺序就是依赖顺序（`package.json:16`）：

```text
tui → telemetry → providers → agent-core → config → coding-agent → apps/cli
```

| Step-Code | 来自 pi 的 | 变化 |
| --- | --- | --- |
| `packages/tui` | `tui` | 43 个源文件里 23 个字节相同；**包名仍叫 pi-tui** |
| `packages/telemetry` | `telemetry` | 8 个文件 7 个相同 |
| `packages/providers` | `ai` | 内置 provider 清零；新增 `dialect/`、`availability/` |
| `packages/agent-core` | `agent` | 55 个同路径文件 32 个相同；新增 6 个 `projection*.ts` |
| `packages/config` | — | 新增，2 个文件 |
| `packages/contracts` | `protocol` | 重写成薄契约，零依赖（有闸门守着） |
| `packages/coding-agent` | `coding-agent` | 244 个同路径文件 157 个相同；新增 136 个 |
| `apps/cli` | `coding-agent` 的入口与交互模式 | 新的一层壳 |

pi 是「三层深」的包图；Step-Code 在最上面多了一层 **app 壳**，并在壳内部再分 `ui/` 和 shell（`main` / `args` / `bootstrap` / `modes` / `bun`）。

## 2.2 产品层是怎么挂上去的

这是理解 Step-Code 的钥匙。【代码事实】`apps/cli/src/bootstrap/extensions.ts:36-55`：

```
// apps/cli/src/bootstrap/extensions.ts
/**
 * Build the ordered list of inline extension factories for pi's main().
 *
 * Keep this list in sync with ch5: it is the whole-repo registration point, so
 * adding an extension means adding one entry here — nowhere else.
 */
export function createStepExtensionFactories(deps: StepExtensionFactoryDeps): InlineExtension[] {
	return [
		createStepExtensionInline({
			telemetry: deps.telemetry,
			stepSettings: deps.stepSettings,
			feedbackIdentity: deps.feedbackIdentity,
			permission: deps.permission,
			traceHeaderPolicy: deps.traceHeaderPolicy,
		}),
		createStepCapabilitiesExtensionInline({ telemetry: deps.telemetry }),
		createStepCronExtension({ telemetry: deps.telemetry }),
		createStepGoalExtension({ telemetry: deps.telemetry }),
		...(deps.stepCodeProviderExtension ? [deps.stepCodeProviderExtension] : []),
	];
}
```


`apps/cli/src/main.ts:183-194` 把这个列表作为 `extensionFactories` 交给 pi 的 `main()`。也就是说：

- **权限、goal、cron、plan、tasks、subagent、workflow、MCP、插件，全部是「内联扩展」**——和第三方扩展走同一套 `ExtensionAPI`，只是随二进制一起发。
- 连唯一的 provider 也不例外：`features/step-provider/index.ts:60-64` 调的是 `pi.registerProvider()`。
- pi 自己也有内联扩展这个机制（`pi/packages/coding-agent/src/main.ts:563`，只挂了一个隐藏的 `llama.cpp`）；Step-Code 把它当成了**整个产品层的装配方式**。

【推断】这解释了为什么 280 个文件能保持字节相同：策略没有写进内核，而是写在内核已有的缝上。代价是策略的力度受扩展事件的力度限制——[第 5 章](./05-tools-permissions.md)的 `!` 命令绕过就是这个限制的直接后果。

## 2.3 18 道闸门

pi 有 4 个 `check-*.mjs`（`browser-smoke`、`lockfile-commit`、`pinned-deps`、`ts-relative-imports`）。Step-Code 有 18 个、共 2,181 行，14 个是新的。`pnpm run check`（`package.json:19`）串起其中 15 个：

| 闸门 | 编号 | 守什么 | 来源 |
| --- | --- | --- | --- |
| `pinned-deps` | — | 依赖必须是精确 semver | pi，加了 `--self-test` |
| `ts-relative-imports` | — | 相对导入带 `.ts` 后缀 | pi，加了 `--self-test` |
| `layer-direction` | S0-3 | 依赖只许自上而下，四条规则 | 新 |
| `ui-layer` | — | UI 层内部边界 | 新 |
| `workspace-registry` | — | workspace 注册表一致 | 新 |
| `tui-no-ai` | S0-5 | TUI 包零 AI 依赖 | 新 |
| `coding-agent-entry-freeze` | S0-6 | bin / exports 只能是基线 JSON 的子集 | 新 |
| `contracts-deps-empty` | — | contracts 包零依赖 | 新 |
| `derived-compat-only` | — | 兼容层只能派生，不能手写 | 新 |
| `no-provider-dispatch` | S5-3 | 适配器里不许 `switch(provider)` | 新 |
| `metadata-not-in-dispatch` | — | 元数据不进分发路径 | 新 |
| `no-secret-leak` | S5-7 | 可用性探针的错误串里不许插入凭据变量 | 新 |
| `legacy-scope-prefix` | — | 旧 scope 前缀不许新增 | 新 |
| `no-observability` | — | 公开树里不许出现可观测性实现 | 新 |
| `public-boundary` | — | 内部路径不许进公开仓库 | 新 |

另外三个不在 `check` 链里：`browser-smoke`（pi 原样）、`lockfile-commit`（pi 原样，`.husky/pre-commit` 调）、`commit-attribution`（新，单独的 workflow）。pi 的 `check:shrinkwrap` 和 `check:install-lock:coding-agent` 没带过来——换成 pnpm 之后不需要了。

### 分层规则长什么样

```
// scripts/check-layer-direction.mjs
// S0-3 layer-direction check.
//
// Enforces the "依赖只许自上而下" rule between the three layers, keyed off the app-internal
// absolute import prefix "#" (apps/cli/package.json maps "#*" -> "./src/*.ts", so "#ui/index"
// means apps/<app>/src/ui/index.ts). Rules:
//   1  app shell/shared may reach the UI only through the single door "#ui/index" (or "#ui");
//      importing any deeper "#ui/..." internal is forbidden.
//   2  the UI (apps/<app>/src/ui/**) must not reverse-import the shell (main/args/bootstrap/modes/bun).
// …
// apps/cli currently has no ui/ or shell subdirs, so the real scan finds nothing to flag yet —
// the rules are in place for steps 3/4. The --self-test exercises every rule with synthetic
// (importer, specifier) pairs (no fixture files: an app-internal fixture would have to live under
// apps/<app>/src and would then be compiled/linted by the real gate).
```


（规则 3、4 的两行含自家 scope，这里略去：能力包和扩展都不许导入 app 包。）

两点值得记下：

1. **实现是 TypeScript AST，不是正则**（`import ts from "typescript"`），判定函数全是纯函数——所以才能做下面的自测。
2. **注释已经过时**：`:14` 还写着「apps/cli currently has no ui/ or shell subdirs」，而 `apps/cli/src/ui/` 现在有 6,753 行的交互模式。闸门本身在工作，注释没跟上。

### 闸门自己也要被测

15 个闸门带 `--self-test`：用合成的（导入方，说明符）对把每条规则各打一遍。【实机】在 `git archive` 副本里逐个运行，15 个全部退出码 0。

更关键的是这一段（`scripts/guard-self-tests.test.mjs:6-11`）：

```
// scripts/guard-self-tests.test.mjs
// Every guard that ships a `--self-test` convention. The self-tests assert the
// guard's own detection logic against known clean/violation fixtures, but they
// were only ever run by hand — so a guard whose logic silently broke would keep
// reporting "passed" in CI. This suite runs each guard's --self-test under
// `node --test scripts/*.test.mjs` (wired into `pnpm run test:scripts`) so a
// broken guard fails the build.
```


`package.json:44` 的 `test` 先跑 `test:scripts` 再跑各包测试，所以**一个检测逻辑坏掉的闸门会让 CI 红**，而不是永远报「passed」。pi 的 4 个检查脚本没有自测。

## 2.4 供应链纪律

| 纪律 | pi | Step-Code |
| --- | --- | --- |
| 依赖精确钉版 | ✅ | ✅ `check-pinned-deps.mjs` |
| CI 用冻结锁文件 | ✅ | ✅ `ci.yml:35` `pnpm install --frozen-lockfile --ignore-scripts` |
| Actions 按 SHA 钉 | ✅ | ✅ checkout v7.0.1、setup-node v7.0.0 |
| 定时审计 | ✅ | ✅ `npm-audit.yml`，cron `37 7 * * *`，`pnpm audit --prod --audit-level moderate` |
| 锁文件改动要显式提交 | ✅ | ✅ `.husky/pre-commit` |
| **扩展安装时禁用脚本** | ❌ | ❌ `core/package-manager.ts:1770-1791` 仍然没有 `--ignore-scripts` |

最后一行是 pi 的 S1 发现，原样继承。CI 里自己装依赖时加了 `--ignore-scripts`，给用户装扩展时没加——同一个仓库里两种标准。

## 2.5 公开边界：一个衍生项目特有的闸门

【代码事实】`scripts/check-public-boundary.mjs:1-25` 列了一组不许出现在公开树里的路径（内部 CI 配置、执行计划文档、版本号脚本等）；【文档】`docs/open-source-status.md:1-33` 说明私有的可观测性实现和端点取值留在公开仓库之外。

配合 `check-no-observability.mjs`，这两道闸门回答的是「开源的这一份和内部跑的那一份差在哪」——答案被写成了机器可查的规则，而不是一句承诺。[第 8 章](./08-observability.md)展开。

## 2.6 本章结论

1. Step-Code 的架构改动不在内核，在**边界**：加一层 app 壳、把 UI 从 coding-agent 搬出去、把产品层写成内联扩展。
2. pi「没有机器强制的架构规则」，Step-Code 补了 14 道，而且 15 道带自测、自测进 CI。这是全仓最能直接搬走的工程实践。
3. 闸门也会腐化：过时注释、`pnpm-workspace.yaml` 里列着不存在的 `packages/extensions/*`、TUI 包名没改。规则在跑，文档没跟上。
4. 供应链纪律原样继承，包括 pi 的那处不一致（扩展安装不禁脚本）。
