import { estimateTokens, measureContextFiles } from "./context-files.ts";
import { CWD, DEMO_FS, HOME, PROMPTS, TOOLS, TOOL_SNIPPETS } from "./fixtures.ts";
import { emitBeforeAgentStart, type BeforeAgentStartHandler, type Named } from "./inject.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { loadResources } from "./resources.ts";
import { expandSkillCommand } from "./skills.ts";
import { runStrategy, STRATEGIES } from "./strategies.ts";

const section = (title: string) => console.log(`\n== ${title} ==`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** 按终端显示宽度补空格：中文占两格。 */
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - [...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));

section("1. AGENTS.md 发现：全局 → 祖先 → cwd，每层一份");
const untrusted = loadResources({ fs: DEMO_FS, cwd: CWD, home: HOME, trusted: false });
for (const file of untrusted.contextFiles) console.log(`  ${file.path}`);
const budget = measureContextFiles(untrusted.contextFiles, 1_000);
console.log(`  未信任项目也照样加载 ${untrusted.contextFiles.length} 份，共约 ${budget.totalTokens} token${budget.overBudget ? "（超出 1000 token 预算）" : ""}`);

section("2. 技能：信任之后项目技能才出现，同名时项目的赢");
const trusted = loadResources({ fs: DEMO_FS, cwd: CWD, home: HOME, trusted: true });
console.log(`  未信任：${untrusted.skills.skills.map((s) => s.name).join(", ")}`);
console.log(`  已信任：${trusted.skills.skills.map((s) => `${s.name}(${s.source})`).join(", ")}`);
for (const d of trusted.skills.diagnostics) console.log(`  ! [${d.type}] ${d.path.replace("/work/shop/", "")}：${d.message}`);

section("3. system prompt 拼装顺序");
const options = { toolSnippets: TOOL_SNIPPETS, cwd: CWD, contextFiles: trusted.contextFiles, skills: trusted.skills.skills };
const prompt = buildSystemPrompt(options);
const markers = ["Available tools:", "<project_context>", "<available_skills>", "Current working directory:"];
for (const marker of markers) console.log(`  @${String(prompt.indexOf(marker)).padStart(5)}  ${marker}`);
console.log(`  全长约 ${estimateTokens(prompt)} token；skill-author 设了 disable-model-invocation，不在清单里：${!prompt.includes("skill-author")}`);
const noRead = buildSystemPrompt({ ...options, selectedTools: ["bash", "edit"] });
console.log(`  去掉 read 工具后技能清单还在吗：${noRead.includes("<available_skills>")}`);

section("4. /skill: 展开进用户消息");
const expanded = expandSkillCommand(DEMO_FS, trusted.skills.skills, "/skill:db-migrate 给 refunds 表加一列");
console.log(expanded.text.split("\n").map((line) => `  | ${line}`).join("\n"));
const author = expandSkillCommand(DEMO_FS, trusted.skills.skills, "/skill:skill-author");
console.log(`  skill-author 不在清单里，但用户仍可手动调用：${author.kind}`);
console.log(`  正文里的 </skill> 转义后，整块只剩 ${author.text.split("</skill>").length - 1} 个闭合标签`);

section("5. before_agent_start：链式改写，单个处理器出错不连累别人");
const handlers: readonly Named<BeforeAgentStartHandler>[] = [
  { name: "corp-rules", handler: (e) => ({ systemPrompt: `${e.systemPrompt}\n\n[公司规则 v3]` }) },
  { name: "broken", handler: () => { throw new Error("读取配置失败"); } },
  { name: "ticket", handler: (e) => ({ message: { customType: "ticket", content: `关联工单：${e.prompt.length > 10 ? "PAY-1024" : "无"}` } }) },
  { name: "tone", handler: (e) => ({ systemPrompt: `${e.systemPrompt}\n[语气：简洁]` }) },
];
const started = emitBeforeAgentStart(handlers, PROMPTS[0] ?? "", prompt);
console.log(`  追加到基础 prompt 之后的部分：${JSON.stringify(started.systemPrompt?.slice(prompt.length))}`);
console.log(`  注入消息：${started.messages.map((m) => `${m.customType}=${m.content}`).join("; ")}`);
console.log(`  错误：${started.errors.map((e) => `${e.handler}: ${e.error}`).join("; ")}`);
console.log(`  下一轮没人改：${emitBeforeAgentStart([], "下一轮", prompt).systemPrompt === undefined ? "退回基础版本" : "沿用覆盖"}`);

section(`6. 前缀缓存：${PROMPTS.length} 轮对话，同一条会变的环境信息，六种放法`);
const scenario = { tools: TOOLS, baseSystemPrompt: prompt, prompts: PROMPTS };
console.log(`  ${pad("策略", 22)}输入 token  命中 token  命中率  过期轮数  历史里的注入`);
for (const strategy of STRATEGIES) {
  const run = runStrategy(strategy, scenario);
  console.log(`  ${pad(run.name, 22)}${String(run.inputTokens).padStart(10)}  ${String(run.cachedTokens).padStart(10)}  ${pct(run.hitRate).padStart(6)}  ${String(run.staleTurns).padStart(8)}  ${String(run.injectedInHistory).padStart(12)}`);
}
