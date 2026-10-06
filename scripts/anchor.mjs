// 标题锚点的唯一规则。
//
// 正文里的链接按 GitHub 的写法（`#32-单步重试`），这样在 GitHub 上直接读也能跳。
// 站点构建（.vitepress/config.mts）和链接检查（check-links.mjs）都用这一个函数，
// 否则 VitePress 默认生成的 `_3-2-单步重试` 会让站点上的锚点全部落空。

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
