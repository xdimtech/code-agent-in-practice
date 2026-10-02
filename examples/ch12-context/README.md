# ch12-context

对应 [第 12 章 改造 system prompt 与上下文](../../book/02-getting-started/ch12-context.md)。

这个例子按 pi 的规则，把 system prompt 和上下文注入的整条路径写了一遍：

- AGENTS.md 发现：每个目录只取一份，先全局、再从根目录走到 cwd，不看项目信任
- Skills 加载：目录扫描、名字校验、项目信任门、同名冲突时项目技能优先
- 两段式注入：system prompt 里只放技能清单，`/skill:name` 再把正文展开进用户消息
- 拼装顺序：角色 → append → `<project_context>` → 技能清单 → 工作目录
- 扩展注入链：`before_agent_start` 链式改写 system prompt 并收集消息；`context` 钩子只影响这一次请求
- 前缀缓存模拟：同一条会变的环境信息有六种放法，比较它们的命中率、过期轮数和历史膨胀

整个例子零依赖，文件系统是内存里的 `Map`，不读真实磁盘，也不连网络。

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| 五个候选文件名，每目录取第一个；全局 → 根 → cwd，按路径去重 | `resource-loader.ts:71-89`、`:119-157` | `src/context-files.ts` |
| AGENTS.md 不看信任；项目技能要信任 | `docs/security.md:27`、`package-manager.ts:2398-2401`、`:2417` | `src/resources.ts` |
| 技能名校验只警告；缺 description 才不加载 | `skills.ts:91-112`、`:277-346` | `src/skills.ts` |
| 同名技能：项目 > 用户，后来的记一条 collision | `package-manager.ts:177-192`、`:2585`；`skills.ts:425-446` | `src/skills.ts` 的 `loadSkills`、`src/resources.ts` 的 `skillRoots` |
| `.agents/skills` 往上走到 git 根为止 | `package-manager.ts:462-481` | `src/resources.ts` 的 `ancestorAgentsSkillDirs` |
| 拼装顺序；没有 read 工具就不放技能清单 | `system-prompt.ts:28-169`、`:161-164` | `src/prompt.ts` |
| `/skill:` 展开进用户消息，参数接在后面 | `agent-session.ts:1354-1377` | `src/skills.ts` 的 `expandSkillCommand`（另做了转义） |
| `before_agent_start` 串行链式、单个出错不连累别人；没人改就退回基础版本 | `runner.ts:1131-1195`、`agent-session.ts:1298-1306` | `src/inject.ts`、`src/session.ts` |
| `context` 钩子拿副本，不写回历史 | `runner.ts:1034-1063` | `src/inject.ts` 的 `emitContext` |
| 缓存断点：最后一个工具、system、最后一条用户消息 | `ai/src/api/anthropic-messages.ts:1360`、`:1025-1032`、`:1295-1316` | `src/cache.ts` |

```bash
npm start   # 六段演示：AGENTS.md 发现、技能加载、拼装顺序、/skill: 展开、注入链、六种策略的缓存对比
npm test    # 43 个用例
```

需要 Node ≥ 22.6，因为要用 `--experimental-strip-types` 直接运行 TypeScript。没有依赖，所以不用 `npm i`。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 上下文文件、技能、诊断、消息、请求 |
| `src/vfs.ts` | 内存文件系统：`isFile`、`isDir`、`readdir`、`readFile` |
| `src/context-files.ts` | AGENTS.md 发现、BOM 处理、token 预算估算 |
| `src/frontmatter.ts` | 最小的 `key: value` frontmatter 解析 |
| `src/skills.ts` | 名字校验、目录扫描、冲突处理、技能清单、`/skill:` 展开 |
| `src/resources.ts` | 技能根目录的顺序与信任门，`.agents/skills` 祖先遍历 |
| `src/prompt.ts` | 纯函数的 `buildSystemPrompt` |
| `src/inject.ts` | `emitBeforeAgentStart`、`emitContext` |
| `src/session.ts` | 一轮对话：注入 → 整形 → 组请求 → 写历史 |
| `src/cache.ts` | 请求序列化、缓存断点、前缀缓存模拟 |
| `src/strategies.ts` | 六种环境信息注入策略与评估 |
| `src/fixtures.ts` | 演示用的目录树、工具和 9 轮提问 |
| `src/main.ts` | 演示入口 |
| `src/*.test.ts` | `node:test` 用例 |

改造上下文的三条经验：

1. **会变的东西不要放进 system prompt。** system 一变，它后面的整段历史缓存全部作废。环境信息、时间、git 状态这类东西，要么只在变了的时候注入一条持久消息，要么干脆让模型自己用工具去查（演示第 6 段）。
2. **AGENTS.md 不看信任，技能看信任。** 克隆一个陌生仓库，它的 AGENTS.md 第一轮就进了 system prompt；信任之后，它的同名技能还会盖住你自己的（演示第 1、2 段）。
3. **技能正文进的是用户消息，不是 system prompt。** 清单只占几十个 token，正文按需加载、留在历史里。代价是模型不一定会去读，要强制就用 `/skill:name`（演示第 3、4 段）。
