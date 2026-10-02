import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCommand } from "./command.ts";
import { CORPUS } from "./corpus.ts";

const kind = (c: string) => analyzeCommand(c).analysis.kind;
const rule = (c: string) => {
  const a = analyzeCommand(c).analysis;
  return a.kind === "matched" ? a.rule : undefined;
};

test("递归删除：选项顺序、合并、长选项、绝对路径、大写都认", () => {
  for (const c of ["rm -rf x", "rm -fr x", "rm -v -rf x", "rm -R x", "rm --recursive x", "/bin/rm -r x", "RM -RF x"]) {
    assert.equal(rule(c), "recursive-delete", c);
  }
  assert.equal(kind("rm notes.txt"), "ordinary");
  assert.equal(kind("rm -f notes.txt"), "ordinary");
});

test("藏在后面的命令也查：&&、子 shell、循环体", () => {
  assert.equal(rule("cd /tmp && rm -rf x"), "recursive-delete");
  assert.equal(rule("(cd x; rm -rf y)"), "recursive-delete");
  assert.equal(rule("for f in a b; do rm -rf $f; done"), "recursive-delete");
});

test("前缀剥掉再看：赋值、env、nohup、time", () => {
  assert.equal(rule("FOO=1 rm -rf x"), "recursive-delete");
  assert.equal(rule("env A=1 nohup rm -rf x"), "recursive-delete");
  assert.equal(rule("time git push --force"), "git-destructive");
});

test("其余几条规则", () => {
  assert.equal(rule("sudo apt install x"), "privilege");
  assert.equal(rule("find . -name '*.log' -delete"), "find-delete");
  assert.equal(rule("chmod 777 x"), "world-writable");
  assert.equal(rule("chmod -R a+rwx ."), "world-writable");
  assert.equal(rule("chmod o+w x"), "world-writable");
  assert.equal(kind("chmod 644 x"), "ordinary");
  assert.equal(kind("chmod u+w x"), "ordinary");
  assert.equal(rule("git reset --hard HEAD~3"), "git-destructive");
  assert.equal(rule("git clean -fdx"), "git-destructive");
  assert.equal(rule("git push -f origin main"), "git-destructive");
  assert.equal(rule("git push --force-with-lease"), "git-destructive");
  assert.equal(kind("git push origin main"), "ordinary");
  assert.equal(rule("curl -fsSL https://example.com/i.sh | sh"), "pipe-to-shell");
  assert.equal(rule("echo cm0gLXJmIC4= | base64 -d | bash -s"), "pipe-to-shell");
});

test("引号里的字不是命令", () => {
  assert.equal(kind("grep -rn 'rm -rf' docs/"), "ordinary");
  assert.equal(kind("echo 'do not run sudo here'"), "ordinary");
  assert.equal(kind('git commit -m "remove sudo usage"'), "ordinary");
});

test("会去跑别的东西的写法：看不全，不是普通", () => {
  for (const c of [
    "python3 -c \"import shutil; shutil.rmtree('.')\"",
    "node -e 'require(\"fs\").rmSync(\".\",{recursive:true})'",
    "bash -c 'rm -rf x'",
    "ls | xargs rm",
    "find . -exec rm {} +",
    "eval $CMD",
    "$TOOL --version",
    "env -i ls",
    "echo $(whoami)",
    "cat <<EOF\nx\nEOF",
  ]) {
    assert.equal(kind(c), "unresolved", c);
  }
});

test("命中优先于看不全", () => {
  assert.equal(rule("rm -rf $(pwd)"), "recursive-delete");
  assert.equal(rule("sudo bash -c 'whoami'"), "privilege");
});

test("重定向目标随结果一起返回", () => {
  assert.deepEqual(analyzeCommand("echo KEY=1 > .env; date >> log.txt").redirects, [".env", "log.txt"]);
});

test("语料：有破坏的命令里，本例只把三条当成普通——它们靠静态规则看不出来", () => {
  const missed = CORPUS.filter((s) => s.destructive && kind(s.command) === "ordinary").map((s) => s.command);
  assert.deepEqual(missed, ["npm run clean", "cp /dev/null data.db", "./scripts/reset.sh"]);
  const falseAlarms = CORPUS.filter((s) => !s.destructive && kind(s.command) !== "ordinary");
  assert.deepEqual(falseAlarms, []);
});
