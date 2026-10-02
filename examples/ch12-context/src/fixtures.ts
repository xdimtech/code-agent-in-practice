import type { ToolDef, Vfs } from "./types.ts";

export const HOME = "/home/dev";
export const REPO = "/work/shop";
export const CWD = "/work/shop/services/pay";

const skill = (fields: Readonly<Record<string, string>>, body: string): string =>
  ["---", ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), "---", "", body].join("\n");

/** 一份「公司规范」，故意写得长一点：它每个请求都要带着。 */
const REPO_RULES = [
  "# shop 仓库规范",
  "",
  ...Array.from({ length: 24 }, (_, i) => `- 规则 ${i + 1}：金额一律用整数分存储，接口层再换算；日志里不打印卡号、手机号等个人信息。`),
].join("\n");

export const DEMO_FS: Vfs = new Map([
  [`${HOME}/.pi/agent/AGENTS.md`, "用中文回答；提交信息用 conventional commits。"],
  [`${HOME}/.pi/agent/skills/deploy/SKILL.md`, skill({ name: "deploy", description: "我自己的部署脚本" }, "运行 ./scripts/my-deploy.sh")],
  [`${HOME}/.pi/agent/skills/review/SKILL.md`, skill({ name: "review", description: "按团队清单做代码评审" }, "逐条对照 checklist.md")],
  ["/work/AGENTS.md", "# 公司通用约定\n所有服务必须暴露 /healthz。"],
  ["/work/.agents/skills/outside/SKILL.md", skill({ description: "在 git 根之外，不会被发现" }, "-")],
  [`${REPO}/.git/HEAD`, "ref: refs/heads/main"],
  [`${REPO}/AGENTS.md`, REPO_RULES],
  [`${REPO}/CLAUDE.md`, "同一目录里排在 AGENTS.md 后面，不会被读到。"],
  [`${REPO}/.agents/skills/db-migrate/SKILL.md`, skill({ description: "生成并校验数据库迁移脚本" }, "1. 先跑 make migrate-dry\n2. 再看 references/rules.md")],
  [`${REPO}/.agents/skills/db-migrate/references/rules.md`, "迁移必须可回滚。"],
  [`${REPO}/.agents/skills/Bad_Name/SKILL.md`, skill({ description: "名字不合规，但照样加载" }, "-")],
  [`${REPO}/.agents/skills/no-desc/SKILL.md`, skill({ name: "no-desc" }, "缺 description，不加载")],
  [`${REPO}/.agents/skills/node_modules/dep/SKILL.md`, skill({ description: "node_modules 里的不扫" }, "-")],
  [`${REPO}/.agents/skills/skill-author/SKILL.md`, skill({ description: "教你写技能", "disable-model-invocation": "true" }, "模板：\n<skill>\n...\n</skill>\n写完之后自测一遍。")],
  [`${CWD}/AGENTS.override.md`, "# pay 服务（临时覆盖）\n本周冻结：只修 bug，不加功能。"],
  [`${CWD}/AGENTS.md`, "# pay 服务\n被同目录的 AGENTS.override.md 遮住了。"],
  [`${CWD}/.pi/skills/deploy/SKILL.md`, skill({ name: "deploy", description: "pay 服务的部署流程（项目版）" }, "运行 make deploy-pay")],
]);

export const TOOLS: readonly ToolDef[] = [
  { name: "read", description: "Read a file. Supports offset/limit for large files." },
  { name: "bash", description: "Execute a bash command in the current working directory." },
  { name: "edit", description: "Replace exact text in a file." },
  { name: "write", description: "Create or overwrite a file." },
];

export const TOOL_SNIPPETS: Readonly<Record<string, string>> = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.description]));

export const PROMPTS: readonly string[] = Array.from({ length: 9 }, (_, i) => `第 ${i + 1} 个问题：看一下 src/refund.ts 第 ${40 + i * 10} 行附近的逻辑，有没有漏掉的分支？`);
