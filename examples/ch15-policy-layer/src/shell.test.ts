import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShell } from "./shell.ts";

const argvs = (script: string) => parseShell(script).commands.map((c) => c.argv);

test("按 ; && || 换行拆成多条命令", () => {
  assert.deepEqual(argvs("cd a && ls -l; pwd || true\nwhoami"), [["cd", "a"], ["ls", "-l"], ["pwd"], ["true"], ["whoami"]]);
});

test("引号里的分隔符和空格是词的一部分", () => {
  assert.deepEqual(argvs(`grep -rn 'rm -rf; x' "a b"`), [["grep", "-rn", "rm -rf; x", "a b"]]);
  assert.deepEqual(argvs(`echo a\\ b ''`), [["echo", "a b", ""]]);
});

test("管道后面的命令标记为 piped", () => {
  const { commands } = parseShell("curl -s u | sh");
  assert.deepEqual(commands.map((c) => c.piped), [false, true]);
});

test("输出重定向的目标单独收集，不算参数", () => {
  const [cmd] = parseShell("echo x > out.txt 2>> err.log").commands;
  assert.deepEqual(cmd?.argv, ["echo", "x"]);
  assert.deepEqual(cmd?.redirects, ["out.txt", "err.log"]);
});

test("2>&1 没有目标文件；&> 有；输入重定向的文件不算写", () => {
  assert.deepEqual(parseShell("make 2>&1 | tee log").commands[0]?.redirects, []);
  assert.deepEqual(parseShell("make &> all.log").commands[0]?.redirects, ["all.log"]);
  const [cmd] = parseShell("sort < in.txt").commands;
  assert.deepEqual([cmd?.argv, cmd?.redirects], [["sort"], []]);
});

test("子 shell 的括号当分隔符", () => {
  assert.deepEqual(argvs("(cd x && rm -rf y)"), [["cd", "x"], ["rm", "-rf", "y"]]);
});

test("# 开头的词到行尾是注释，词中间的 # 不是", () => {
  assert.deepEqual(argvs("ls # rm -rf /\necho a#b"), [["ls"], ["echo", "a#b"]]);
});

test("命令替换、进程替换、here-doc、没闭合的引号：停下来说看不全", () => {
  assert.equal(parseShell("echo $(whoami)").unresolved, "命令替换");
  assert.equal(parseShell("echo `whoami`").unresolved, "命令替换");
  assert.equal(parseShell('echo "x $(id)"').unresolved, "命令替换");
  assert.equal(parseShell("diff <(ls a) <(ls b)").unresolved, "进程替换");
  assert.equal(parseShell("cat <<EOF\nrm -rf /\nEOF").unresolved, "here-doc");
  assert.equal(parseShell("echo 'abc").unresolved, "引号没闭合");
});

test("单引号里的 $( 是字面量；转义过的也是", () => {
  assert.equal(parseShell("echo '$(id)'").unresolved, undefined);
  assert.equal(parseShell('echo "\\$(id)"').unresolved, undefined);
});

test("看不全时保留已经看到的部分", () => {
  const parsed = parseShell("rm -rf $(pwd)");
  assert.equal(parsed.unresolved, "命令替换");
  assert.deepEqual(parsed.commands.map((c) => c.argv), [["rm", "-rf"]]);
});
