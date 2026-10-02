import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, formatContextFiles } from "./prompt.ts";

const skill = { name: "s", description: "d", filePath: "/s/SKILL.md", baseDir: "/s", source: "user", disableModelInvocation: false };
const files = [{ path: "/r/AGENTS.md", content: "规则" }];

test("顺序：角色 → append → project_context → 技能清单 → appendix → 工作目录", () => {
  const prompt = buildSystemPrompt({ appendSystemPrompt: "APPEND", contextFiles: files, skills: [skill], appendix: "<env>x</env>", cwd: "/r" });
  const at = ["Available tools:", "APPEND", "<project_context>", "<available_skills>", "<env>x</env>", "Current working directory: /r"].map((m) => prompt.indexOf(m));
  assert.ok(at.every((n) => n >= 0), String(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.ok(prompt.endsWith("Current working directory: /r"));
});

test("纯函数：同样的输入拼出逐字节相同的字符串", () => {
  const options = { contextFiles: files, skills: [skill], cwd: "/r" };
  assert.equal(buildSystemPrompt(options), buildSystemPrompt({ ...options }));
});

test("工具只在有说明时列出；没有就写 (none)", () => {
  assert.match(buildSystemPrompt({ cwd: "/" }), /Available tools:\n\(none\)/);
  const prompt = buildSystemPrompt({ selectedTools: ["read", "grep"], toolSnippets: { read: "读文件" }, cwd: "/" });
  assert.match(prompt, /- read: 读文件/);
  assert.doesNotMatch(prompt, /- grep/);
});

test("指南：去重、去空白；只有 bash 没有搜索工具时补一条；固定两条总在最后", () => {
  const prompt = buildSystemPrompt({ selectedTools: ["bash"], promptGuidelines: [" 用 rg ", "用 rg", " "], cwd: "/" });
  const lines = prompt.split("Guidelines:\n")[1]?.split("\n\n")[0]?.split("\n").filter((l) => l.startsWith("- ")) ?? [];
  assert.deepEqual(lines, ["- Use bash for file operations like ls, rg, find", "- 用 rg", "- Be concise in your responses", "- Show file paths clearly when working with files"]);
});

test("没有 read 工具：技能清单整段消失（模型没法去读正文）", () => {
  assert.doesNotMatch(buildSystemPrompt({ selectedTools: ["bash"], skills: [skill], cwd: "/" }), /available_skills/);
  assert.match(buildSystemPrompt({ skills: [skill], cwd: "/" }), /available_skills/);
});

test("customPrompt：替换角色和工具列表，后面几段照拼，末尾多一个换行", () => {
  const prompt = buildSystemPrompt({ customPrompt: "你是支付组的助手。", contextFiles: files, skills: [skill], cwd: "C:\\repo" });
  assert.ok(prompt.startsWith("你是支付组的助手。\n\n<project_context>"));
  assert.doesNotMatch(prompt, /Available tools/);
  assert.match(prompt, /<available_skills>/);
  assert.ok(prompt.endsWith("Current working directory: C:/repo\n"));
});

test("project_context：整份内容原样放进去，路径做属性", () => {
  assert.equal(formatContextFiles([]), "");
  assert.equal(formatContextFiles(files), '\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n<project_instructions path="/r/AGENTS.md">\n规则\n</project_instructions>\n\n</project_context>\n');
});
