import { loadContextFiles } from "./context-files.ts";
import { loadSkills, type SkillRoot } from "./skills.ts";
import type { ContextFile, LoadSkillsResult, Vfs } from "./types.ts";
import { dirname, isDir, join } from "./vfs.ts";

export interface ResourceOptions {
  readonly fs: Vfs;
  readonly cwd: string;
  readonly home: string;
  readonly trusted: boolean;
}

export interface Resources {
  readonly contextFiles: readonly ContextFile[];
  readonly skills: LoadSkillsResult;
}

function findGitRoot(fs: Vfs, start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (isDir(fs, join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** package-manager.ts:462-481：从 cwd 往上找 .agents/skills，到 git 根为止；不在仓库里就一直走到 /。 */
export function ancestorAgentsSkillDirs(fs: Vfs, cwd: string): readonly string[] {
  const gitRoot = findGitRoot(fs, cwd);
  const dirs: string[] = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    dirs.push(join(dir, ".agents", "skills"));
    if (dir === gitRoot || dirname(dir) === dir) return dirs;
  }
}

/**
 * 实际运行时的优先级（package-manager.ts:177-192，排序在 :2585）：项目 > 用户。
 * 项目目录只有被信任才会出现（:2398-2401、:2417）。
 */
export function skillRoots(options: ResourceOptions): readonly SkillRoot[] {
  const userAgents = join(options.home, ".agents", "skills");
  const project: readonly SkillRoot[] = options.trusted
    ? [join(options.cwd, ".pi", "skills"), ...ancestorAgentsSkillDirs(options.fs, options.cwd).filter((dir) => dir !== userAgents)].map((dir) => ({ dir, source: "project" }))
    : [];
  const user: readonly SkillRoot[] = [join(options.home, ".pi", "agent", "skills"), userAgents].map((dir) => ({ dir, source: "user" }));
  return [...project, ...user];
}

/**
 * 两类资源对信任的态度不一样：
 * AGENTS.md 不看信任，照样加载（docs/security.md:27）；项目技能要信任之后才加载。
 */
export function loadResources(options: ResourceOptions): Resources {
  return {
    contextFiles: loadContextFiles({ fs: options.fs, cwd: options.cwd, agentDir: join(options.home, ".pi", "agent") }),
    skills: loadSkills(options.fs, skillRoots(options)),
  };
}
