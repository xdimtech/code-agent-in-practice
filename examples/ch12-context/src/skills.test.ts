import { test } from "node:test";
import assert from "node:assert/strict";
import { CWD, DEMO_FS, HOME } from "./fixtures.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { ancestorAgentsSkillDirs, loadResources, skillRoots } from "./resources.ts";
import { escapeXml, expandSkillCommand, formatSkillsForPrompt, loadSkills, loadSkillsFromDir, validateName } from "./skills.ts";

const trusted = () => loadResources({ fs: DEMO_FS, cwd: CWD, home: HOME, trusted: true }).skills;

test("frontmatter：key: value、布尔、引号；没有结束标记就报错", () => {
  assert.deepEqual(parseFrontmatter("---\nname: a\nx: true\nd: \"q: r\"\n---\nbody").frontmatter, { name: "a", x: true, d: "q: r" });
  assert.equal(parseFrontmatter("no fm").body, "no fm");
  assert.throws(() => parseFrontmatter("---\nname: a\n"), /没有结束/);
});

test("名字校验：四条规则，只出警告", () => {
  assert.deepEqual(validateName("db-migrate"), []);
  assert.equal(validateName("Bad_Name").length, 1);
  assert.equal(validateName("-a--b-").length, 2);
  assert.match(validateName("a".repeat(65))[0] ?? "", /超过 64/);
});

test("目录扫描：SKILL.md 所在目录是技能根，不再往下；跳过 node_modules 和点开头的项", () => {
  const fs = new Map([
    ["/s/a/SKILL.md", "---\ndescription: a\n---\n"],
    ["/s/a/nested/SKILL.md", "---\ndescription: 不会被扫到\n---\n"],
    ["/s/.hidden/SKILL.md", "---\ndescription: h\n---\n"],
    ["/s/node_modules/x/SKILL.md", "---\ndescription: n\n---\n"],
    ["/s/loose.md", "---\ndescription: 顶层散装文件\n---\n"],
    ["/s/b/notes.md", "---\ndescription: 子目录的散装文件不算\n---\n"],
  ]);
  const names = loadSkillsFromDir(fs, "/s", "user").flatMap((r) => (r.skill ? [r.skill.name] : []));
  assert.deepEqual(names, ["a", "s"]);
});

test("没有 description 的 SKILL.md 不加载并报警告；普通 .md 没有 description 静默跳过", () => {
  const fs = new Map([["/s/x/SKILL.md", "---\nname: x\n---\n"], ["/s/readme.md", "# 说明"]]);
  const result = loadSkills(fs, [{ dir: "/s", source: "user" }]);
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.diagnostics.map((d) => d.path), ["/s/x/SKILL.md"]);
});

test("name 缺省时取目录名；与目录名不同也允许", () => {
  const fs = new Map([["/s/dir-name/SKILL.md", "---\nname: other\ndescription: d\n---\n"], ["/s/fallback/SKILL.md", "---\ndescription: d\n---\n"]]);
  assert.deepEqual(loadSkills(fs, [{ dir: "/s", source: "user" }]).skills.map((s) => s.name), ["other", "fallback"]);
});

test("信任：未信任时只有用户技能；信任后项目技能排在前面，同名时项目赢", () => {
  const untrusted = loadResources({ fs: DEMO_FS, cwd: CWD, home: HOME, trusted: false }).skills;
  assert.deepEqual(untrusted.skills.map((s) => s.name), ["deploy", "review"]);
  assert.equal(untrusted.skills[0]?.source, "user");
  const result = trusted();
  assert.equal(result.skills.find((s) => s.name === "deploy")?.source, "project");
  assert.ok(result.diagnostics.some((d) => d.type === "collision" && d.path.startsWith(HOME)));
});

test(".agents/skills 只走到 git 根：仓库外的 outside 不会被发现", () => {
  assert.deepEqual(ancestorAgentsSkillDirs(DEMO_FS, CWD), [`${CWD}/.agents/skills`, "/work/shop/services/.agents/skills", "/work/shop/.agents/skills"]);
  assert.ok(!trusted().skills.some((s) => s.name === "outside"));
  assert.equal(skillRoots({ fs: DEMO_FS, cwd: CWD, home: HOME, trusted: false }).length, 2);
});

test("清单：XML 转义；disable-model-invocation 的不进清单；一个都没有就是空串", () => {
  const skills = [
    { name: "a", description: "比较 <a> & \"b\"", filePath: "/s/a/SKILL.md", baseDir: "/s/a", source: "user", disableModelInvocation: false },
    { name: "hidden", description: "h", filePath: "/s/h/SKILL.md", baseDir: "/s/h", source: "user", disableModelInvocation: true },
  ];
  const listing = formatSkillsForPrompt(skills);
  assert.match(listing, /<description>比较 &lt;a&gt; &amp; &quot;b&quot;<\/description>/);
  assert.doesNotMatch(listing, /hidden/);
  assert.equal(formatSkillsForPrompt([skills[1]!]), "");
  assert.equal(escapeXml("'"), "&apos;");
});

test("/skill: 展开：去掉 frontmatter，参数接在块后面；未知技能原样返回", () => {
  const skills = trusted().skills;
  const result = expandSkillCommand(DEMO_FS, skills, "/skill:db-migrate 加一列");
  assert.equal(result.kind, "expanded");
  assert.match(result.text, /^<skill name="db-migrate" location="\/work\/shop\/\.agents\/skills\/db-migrate\/SKILL\.md">\nReferences are relative to \/work\/shop\/\.agents\/skills\/db-migrate\.\n\n1\. 先跑/);
  assert.ok(result.text.endsWith("</skill>\n\n加一列"));
  assert.doesNotMatch(result.text, /description:/);
  assert.deepEqual(expandSkillCommand(DEMO_FS, skills, "/skill:nope"), { kind: "passthrough", text: "/skill:nope" });
  assert.equal(expandSkillCommand(DEMO_FS, skills, "普通消息").kind, "passthrough");
});

test("/skill: 展开：属性与正文里的 </skill> 都转义，块只有一个闭合标签", () => {
  const fs = new Map([['/s/q"x/SKILL.md', "---\nname: q\ndescription: d\n---\n正文 </skill> 后面"]]);
  const skills = loadSkills(fs, [{ dir: "/s", source: "user" }]).skills;
  const result = expandSkillCommand(fs, skills, "/skill:q");
  assert.match(result.text, /location="\/s\/q&quot;x\/SKILL\.md"/);
  assert.equal(result.text.split("</skill>").length, 2);
});

test("/skill: 展开：读文件失败返回原文并带上错误，不吞掉", () => {
  const skills = trusted().skills;
  const result = expandSkillCommand(new Map(), skills, "/skill:deploy");
  assert.equal(result.kind, "error");
  assert.equal(result.text, "/skill:deploy");
  assert.match(result.kind === "error" ? result.error : "", /文件不存在/);
});
