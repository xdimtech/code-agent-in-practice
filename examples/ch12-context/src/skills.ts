import { parseFrontmatter } from "./frontmatter.ts";
import type { Diagnostic, LoadSkillsResult, Skill, Vfs } from "./types.ts";
import { basename, dirname, isDir, join, readFile, readdir } from "./vfs.ts";

export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
const SKILL_FILE = "SKILL.md";

/** 与 skills.ts:91-112 相同的四条规则；违反只记警告，技能照样加载。 */
export function validateName(name: string): readonly string[] {
  return [
    name.length > MAX_NAME_LENGTH ? `name 超过 ${MAX_NAME_LENGTH} 个字符（${name.length}）` : "",
    /^[a-z0-9-]+$/.test(name) ? "" : "name 只能用小写字母、数字和连字符",
    name.startsWith("-") || name.endsWith("-") ? "name 不能以连字符开头或结尾" : "",
    name.includes("--") ? "name 不能有连续的连字符" : "",
  ].filter(Boolean);
}

interface FileResult {
  readonly skill?: Skill;
  readonly diagnostics: readonly Diagnostic[];
}

/** skills.ts:277-346：缺 description 就不加载；其余问题只是警告。 */
export function loadSkillFromFile(fs: Vfs, filePath: string, source: string): FileResult {
  const declared = basename(filePath) === SKILL_FILE;
  const warn = (message: string): Diagnostic => ({ type: "warning", message, path: filePath });
  let frontmatter: Readonly<Record<string, string | boolean>>;
  try {
    ({ frontmatter } = parseFrontmatter(readFile(fs, filePath)));
  } catch (error) {
    // 不是 SKILL.md 的普通 .md 解析失败，pi 也是静默跳过
    return { diagnostics: declared ? [warn(error instanceof Error ? error.message : String(error))] : [] };
  }
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (!declared && !description) return { diagnostics: [] };

  const baseDir = dirname(filePath);
  const name = (typeof frontmatter.name === "string" && frontmatter.name) || basename(baseDir);
  const diagnostics = [
    ...(description ? [] : ["缺少 description，技能不加载"]),
    ...(description.length > MAX_DESCRIPTION_LENGTH ? [`description 超过 ${MAX_DESCRIPTION_LENGTH} 个字符`] : []),
    ...validateName(name),
  ].map(warn);
  if (!description) return { diagnostics };
  const skill: Skill = { name, description, filePath, baseDir, source, disableModelInvocation: frontmatter["disable-model-invocation"] === true };
  return { skill, diagnostics };
}

/**
 * 目录扫描（skills.ts:160-262）：
 * 目录里有 SKILL.md 就是技能根，不再往下钻；跳过点开头的项和 node_modules；
 * 顶层的散装 .md 只有 includeRootFiles 时才算。
 */
export function loadSkillsFromDir(fs: Vfs, dir: string, source: string, includeRootFiles = true): FileResult[] {
  if (!isDir(fs, dir)) return [];
  const entries = readdir(fs, dir).filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules");
  if (entries.some((entry) => entry.kind === "file" && entry.name === SKILL_FILE)) {
    return [loadSkillFromFile(fs, join(dir, SKILL_FILE), source)];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.kind === "dir") return loadSkillsFromDir(fs, path, source, false);
    return includeRootFiles && entry.name.endsWith(".md") ? [loadSkillFromFile(fs, path, source)] : [];
  });
}

export interface SkillRoot {
  readonly dir: string;
  readonly source: "user" | "project";
}

/**
 * 按给定顺序合并：同名先到先得，后来者记一条 collision（skills.ts:425-446）。
 * 顺序由调用方决定——见 resources.ts 的 skillRoots：项目在前、用户在后。
 */
export function loadSkills(fs: Vfs, roots: readonly SkillRoot[]): LoadSkillsResult {
  const results = roots.flatMap((root) => loadSkillsFromDir(fs, root.dir, root.source));
  const loaded = results.flatMap((result) => (result.skill ? [result.skill] : []));
  const skills = loaded.filter((skill, index) => loaded.findIndex((other) => other.name === skill.name) === index);
  const collisions: Diagnostic[] = loaded
    .filter((skill) => !skills.includes(skill))
    .map((skill) => ({ type: "collision", message: `name "${skill.name}" 重名，保留 ${skills.find((s) => s.name === skill.name)?.filePath}`, path: skill.filePath }));
  return { skills, diagnostics: [...results.flatMap((result) => result.diagnostics), ...collisions] };
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** 第一段注入：只把清单放进 system prompt，正文要模型自己用 read 工具去读（skills.ts:355-381）。 */
export function formatSkillsForPrompt(skills: readonly Skill[]): string {
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible.length === 0) return "";
  const items = visible.flatMap((skill) => [
    "  <skill>",
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.filePath)}</location>`,
    "  </skill>",
  ]);
  return [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory and use that absolute path in tool commands.",
    "",
    "<available_skills>",
    ...items,
    "</available_skills>",
  ].join("\n");
}

export type Expansion =
  | { readonly kind: "passthrough"; readonly text: string }
  | { readonly kind: "expanded"; readonly text: string; readonly skill: string }
  | { readonly kind: "error"; readonly text: string; readonly error: string };

/**
 * 第二段注入：用户敲 `/skill:name 参数`，正文展开进这条**用户消息**（agent-session.ts:1354-1377）。
 * 与 pi 的差别：属性值做了转义；正文里出现 `</skill>` 时也转义，免得提前闭合。
 * 读文件失败时返回原文并带上错误，由调用方上报——不吞掉。
 */
export function expandSkillCommand(fs: Vfs, skills: readonly Skill[], text: string): Expansion {
  if (!text.startsWith("/skill:")) return { kind: "passthrough", text };
  const space = text.indexOf(" ");
  const name = space === -1 ? text.slice(7) : text.slice(7, space);
  const args = space === -1 ? "" : text.slice(space + 1).trim();
  const skill = skills.find((candidate) => candidate.name === name);
  if (!skill) return { kind: "passthrough", text };
  try {
    const body = parseFrontmatter(readFile(fs, skill.filePath)).body.trim().replaceAll("</skill>", "&lt;/skill>");
    const block = `<skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    return { kind: "expanded", text: args ? `${block}\n\n${args}` : block, skill: skill.name };
  } catch (error) {
    return { kind: "error", text, error: error instanceof Error ? error.message : String(error) };
  }
}
