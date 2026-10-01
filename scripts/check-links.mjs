// 仓库内链检查。
//
// VitePress 构建本身会报死链，但它只看**被站点收录的页面**。这个脚本补两件
// 它管不到的事：
//   1. SUMMARY.md 里列的章节文件是否真的存在（漏建文件时目录会指向空气）；
//   2. 所有 Markdown 之间的相对链接是否落在真实文件/锚点上，包括 GitHub 上
//      直接阅读时才会走到的那些（README、examples/LICENSE 这类非页面文件）。
//
// 纯函数 + 只读文件系统，不修改任何东西。退出码非 0 表示有问题。

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, relative, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 行内链接与引用式定义都要覆盖 */
const RE_INLINE = /\[(?:[^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const SKIP_PREFIX = ["http://", "https://", "mailto:", "#", "data:"];

/** 受 git 管理的 Markdown 文件，避免扫进 node_modules 和构建产物 */
function listMarkdown() {
  const out = execFileSync("git", ["ls-files", "*.md"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

/** 把 `## 3.1 主循环` 这类标题转成 GitHub 锚点 */
export function toAnchor(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** 去掉代码块后再找链接，否则示例代码里的路径会被当成真链接 */
export function stripFences(text) {
  const kept = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      kept.push("");
      continue;
    }
    kept.push(inFence ? "" : line);
  }
  return kept.join("\n");
}

export function collectAnchors(text) {
  const anchors = new Set();
  for (const line of stripFences(text).split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m) anchors.add(toAnchor(m[1]));
  }
  return anchors;
}

export function collectLinks(text) {
  const links = [];
  const body = stripFences(text);
  for (const line of body.split("\n")) {
    RE_INLINE.lastIndex = 0;
    let m;
    while ((m = RE_INLINE.exec(line)) !== null) links.push(m[1]);
  }
  return links.filter(
    (href) => !SKIP_PREFIX.some((p) => href.toLowerCase().startsWith(p)),
  );
}

/**
 * 站点写法（`/book/x/ch01`，以仓库根为基准、省略 .md）和 GitHub 写法
 * （`../x/ch01.md`，相对当前文件）两种都要认。
 */
function resolveTarget(fromAbs, pathPart) {
  const base = pathPart.startsWith("/") ? ROOT : dirname(fromAbs);
  const direct = resolve(base, "." + (pathPart.startsWith("/") ? pathPart : "/" + pathPart));
  if (!existsSync(direct) && extname(direct) === "" && existsSync(direct + ".md")) {
    return relative(ROOT, direct + ".md");
  }
  return relative(ROOT, direct);
}

function checkOne(file, cache) {
  const abs = resolve(ROOT, file);
  const text = readFileSync(abs, "utf8");
  const problems = [];

  for (const href of collectLinks(text)) {
    const [pathPart, anchor] = href.split("#");

    // 纯锚点（#xxx）已在 SKIP_PREFIX 里排除，这里只处理有路径的
    const targetRel = pathPart === "" ? file : resolveTarget(abs, pathPart);
    const targetAbs = resolve(ROOT, targetRel);

    if (!existsSync(targetAbs)) {
      problems.push(`${href} → 文件不存在`);
      continue;
    }

    // 目录形式的链接：GitHub 会渲染 README.md，站点走 rewrites，两边都要有
    if (statSync(targetAbs).isDirectory()) {
      if (!existsSync(join(targetAbs, "README.md")) && !existsSync(join(targetAbs, "index.md"))) {
        problems.push(`${href} → 目录里没有 README.md / index.md`);
      }
      continue;
    }

    if (!anchor) continue;
    if (extname(targetAbs) !== ".md") {
      problems.push(`${href} → 非 Markdown 文件不支持锚点`);
      continue;
    }

    if (!cache.has(targetRel)) {
      cache.set(targetRel, collectAnchors(readFileSync(targetAbs, "utf8")));
    }
    if (!cache.get(targetRel).has(toAnchor(anchor))) {
      problems.push(`${href} → 锚点不存在`);
    }
  }

  return problems;
}

/** SUMMARY.md 是目录的唯一来源，它指向的每一章都必须已经建档 */
function checkSummaryCoverage() {
  const summary = readFileSync(resolve(ROOT, "SUMMARY.md"), "utf8");
  const listed = new Set();
  for (const href of collectLinks(summary)) {
    const clean = href.split("#")[0].replace(/^\.\//, "");
    if (clean.endsWith(".md")) listed.add(clean);
  }

  const onDisk = listMarkdown().filter((f) => f.startsWith("book/"));
  return onDisk.filter((f) => !listed.has(f)).map((f) => `${f} 不在 SUMMARY.md 里`);
}

function main() {
  const files = listMarkdown();
  const cache = new Map();
  let failures = 0;

  for (const file of files) {
    const problems = checkOne(file, cache);
    if (problems.length === 0) continue;
    failures += problems.length;
    console.error(`\n${file}`);
    for (const p of problems) console.error(`  ✗ ${p}`);
  }

  const orphans = checkSummaryCoverage();
  if (orphans.length > 0) {
    failures += orphans.length;
    console.error("\nSUMMARY.md 覆盖检查");
    for (const o of orphans) console.error(`  ✗ ${o}`);
  }

  if (failures > 0) {
    console.error(`\n共 ${failures} 处问题。`);
    process.exit(1);
  }
  console.log(`链接检查通过：${files.length} 个 Markdown 文件，无死链。`);
}

main();
