import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import { buildSidebar } from "../scripts/summary.mjs";

const BASELINE = "pi b79e4cc8 (v0.84.4)";

// GitHub Pages 项目站点挂在 /<repo>/ 下，资源路径必须带这个前缀。
// 将来换成自定义域名（或迁到 <org>.github.io 仓库）时，设 DOCS_BASE=/ 覆盖。
const BASE = process.env.DOCS_BASE ?? "/code-agent-in-practice/";

export default withMermaid(
  defineConfig({
    title: "Code Agent 实战",
    description: "基于 Pi 从零构建 —— 一本讲工程判断的书，每条结论可追到行号",
    lang: "zh-CN",
    base: BASE,
    cleanUrls: true,
    lastUpdated: true,

    // 根 README 是 GitHub 落地页，与 index.md 重复，不进站点
    srcExclude: ["README.md"],

    // README.md 作为目录首页提供，URL 形如 /research/pi/ 而不是 /research/pi/README
    rewrites: {
      "research/:name/README.md": "research/:name/index.md",
      "examples/README.md": "examples/index.md",
      "examples/:name/README.md": "examples/:name/index.md",
    },

    head: [
      ["meta", { name: "theme-color", content: "#1f6feb" }],
      ["meta", { property: "og:type", content: "book" }],
      ["meta", { property: "og:title", content: "Code Agent 实战：基于 Pi 从零构建" }],
      [
        "meta",
        {
          property: "og:description",
          content:
            "794 行内核 + 6 万行产品层。三家厂商衍生自同一上游，两个独立对照组给出不同解法 —— 五套交付给真实用户的答案。",
        },
      ],
      // head 里的路径不会被 VitePress 自动补 base，必须自己拼
      ["link", { rel: "icon", type: "image/svg+xml", href: `${BASE}figures/logo.svg` }],
    ],

    markdown: {
      lineNumbers: true,
      // 技术书的代码引用必须能定位到行，容器与脚注也常用
      container: {
        tipLabel: "提示",
        warningLabel: "注意",
        dangerLabel: "警告",
        infoLabel: "说明",
        detailsLabel: "展开",
      },
      image: { lazyLoading: true },
    },

    themeConfig: {
      logo: "/figures/logo.svg",
      outline: { level: [2, 3], label: "本章结构" },

      nav: [
        { text: "开始读", link: "/book/00-preface/ch00-1-about" },
        { text: "目录", link: "/book/00-preface/cover" },
        {
          text: "证据层",
          items: [
            { text: "基准版本表", link: "/research/BASELINE" },
            { text: "pi 完整拆解", link: "/research/pi/" },
          ],
        },
        { text: `基准 ${BASELINE}`, link: "/research/BASELINE" },
      ],

      sidebar: buildSidebar(),

      socialLinks: [
        { icon: "github", link: "https://github.com/xdimtech/code-agent-in-practice" },
      ],

      editLink: {
        pattern:
          "https://github.com/xdimtech/code-agent-in-practice/edit/main/:path",
        text: "在 GitHub 上修订本页",
      },

      docFooter: { prev: "上一节", next: "下一节" },
      lastUpdatedText: "最后更新",
      darkModeSwitchLabel: "外观",
      lightModeSwitchTitle: "切换到浅色",
      darkModeSwitchTitle: "切换到深色",
      sidebarMenuLabel: "目录",
      returnToTopLabel: "回到顶部",

      search: {
        provider: "local",
        options: {
          // 中文必须关掉默认的英文分词，否则「上下文压缩」这类词搜不到
          miniSearch: {
            options: {
              tokenize: (text) => text.split(/[\s\-—·、，。：；（）()[\]]+/u),
            },
            searchOptions: { fuzzy: 0.2, prefix: true, combineWith: "AND" },
          },
          translations: {
            button: { buttonText: "搜索全书", buttonAriaLabel: "搜索全书" },
            modal: {
              displayDetails: "显示详情",
              resetButtonTitle: "清除",
              backButtonTitle: "返回",
              noResultsText: "没有匹配的内容",
              footer: {
                selectText: "选择",
                navigateText: "切换",
                closeText: "关闭",
              },
            },
          },
        },
      },

      footer: {
        message:
          '正文 <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh">CC BY-SA 4.0</a> · <code>examples/</code> MIT · 上游 pi 由 Mario Zechner 以 MIT 发布',
        copyright: `基准锁定于 ${BASELINE}，全书行号引用均指向该快照`,
      },
    },

    mermaid: {
      theme: "neutral",
      fontFamily:
        '-apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif',
    },
  }),
);
