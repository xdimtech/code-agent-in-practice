// 解析 SUMMARY.md，产出 VitePress sidebar。
//
// SUMMARY.md 是全书唯一的目录来源 —— 它同时被 GitHub 直接渲染、被本脚本
// 转成站点侧边栏。任何章节的增删改只动那一个文件，站点自动跟随。
//
// 纯函数：读入文本，返回新对象，不修改任何输入。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RE_SECTION = /^##\s+(.+?)\s*$/;
const RE_ITEM = /^-\s+\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/;
const RE_BARE_LINK = /^\[([^\]]+)\]\(([^)]+)\)\s*$/;

/** `./book/01-choosing/ch01-x.md` -> `/book/01-choosing/ch01-x` */
export function toRoute(target) {
  const clean = target.replace(/^\.\//, "").replace(/\.md$/, "");
  return "/" + clean;
}

/**
 * @param {string} text SUMMARY.md 的内容
 * @returns {{sections: Array<{text: string, items: Array<{text: string, link: string, note: string}>}>, preface: Array}}
 */
export function parseSummary(text) {
  const sections = [];
  const preface = [];
  let current = null;
  let inFence = false;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const mSection = RE_SECTION.exec(line);
    if (mSection) {
      current = { text: mSection[1], items: [] };
      sections.push(current);
      continue;
    }

    const mItem = RE_ITEM.exec(line);
    if (mItem) {
      const entry = {
        text: mItem[1],
        link: toRoute(mItem[2]),
        note: mItem[3].replace(/^—\s*/, "").trim(),
      };
      (current ? current.items : preface).push(entry);
      continue;
    }

    const mBare = RE_BARE_LINK.exec(line);
    if (mBare && !current) {
      preface.push({ text: mBare[1], link: toRoute(mBare[2]), note: "" });
    }
  }

  return { sections, preface };
}

/** 读盘并转成 VitePress sidebar 数组 */
export function buildSidebar() {
  const text = readFileSync(resolve(ROOT, "SUMMARY.md"), "utf8");
  const { sections, preface } = parseSummary(text);

  const sidebar = [];

  if (preface.length > 0) {
    sidebar.push({
      text: "开始",
      items: preface.map(({ text, link }) => ({ text, link })),
    });
  }

  for (const section of sections) {
    if (section.items.length === 0) continue;
    sidebar.push({
      text: section.text,
      collapsed: false,
      items: section.items.map(({ text, link, note }) => ({
        // 「待完成」在侧边栏里保留可见，读者一眼知道哪些还没写
        text: note ? `${text} · ${note}` : text,
        link,
      })),
    });
  }

  return sidebar;
}

export { ROOT };
