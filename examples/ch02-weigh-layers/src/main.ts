// 用法：
//   npm start                                   # 称一称本书仓库自己（按目录自动分组）
//   npm start -- --preset pi <pi 仓库>           # 按 pi 的分层称一个仓库
//   npm start -- --preset pi <pi 仓库> <fork>    # 两个仓库逐层对照

import { basename } from "node:path";
import { summarize, type Layer } from "./layers.ts";
import { PRESETS } from "./presets.ts";
import { RepoError, weighRepo } from "./repo.ts";
import { renderCompare, renderSingle } from "./report.ts";

interface Args {
  readonly layers?: readonly Layer[];
  readonly repos: readonly string[];
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Args {
  const i = argv.indexOf("--preset");
  if (i === -1) return { repos: argv.length > 0 ? argv : ["."] };
  const name = argv[i + 1];
  const layers = name === undefined ? undefined : PRESETS[name];
  if (!layers) throw new UsageError(`--preset 只认这些：${Object.keys(PRESETS).join("、")}`);
  const repos = argv.filter((_, j) => j !== i && j !== i + 1);
  return { layers, repos: repos.length > 0 ? repos : ["."] };
}

function weigh(repo: string, layers: readonly Layer[] | undefined) {
  const { root, files, unreadable } = weighRepo(repo);
  if (unreadable.length > 0) console.error(`⚠ ${root}：${unreadable.length} 个已跟踪文件读不到，未计入`);
  return { title: basename(root), rows: summarize(files, layers) };
}

function main(argv: readonly string[]): void {
  const { layers, repos } = parseArgs(argv);
  if (repos.length > 2) throw new UsageError("最多对照两个仓库");
  const weighed = repos.map((r) => weigh(r, layers));
  const [a, b] = weighed;
  console.log(b ? renderCompare(a, b) : renderSingle(a.title, a.rows));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError || error instanceof RepoError)) throw error;
  console.error(error.message);
  process.exit(2);
}
