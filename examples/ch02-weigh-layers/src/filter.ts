// 全书统一的「源码行数」口径，与 research/BASELINE.md §行数怎么量 的 shell 管道逐条对应：
//
//   grep -Ei '\.(ts|tsx)$' | grep -v '\.test\.\|\.spec\.' | grep -vE '(^|/)tests?/'
//     | grep -v '/examples/' | grep -E '/src/'

const SOURCE_EXT = /\.(ts|tsx)$/i;
const TEST_FILE = /\.test\.|\.spec\./;
const TEST_DIR = /(^|\/)tests?\//;
const EXAMPLES_DIR = /\/examples\//;
const SRC_DIR = /\/src\//;

/** 一个 git 跟踪的路径算不算「源码」 */
export function isCountedSource(path: string): boolean {
  return (
    SOURCE_EXT.test(path) &&
    !TEST_FILE.test(path) &&
    !TEST_DIR.test(path) &&
    !EXAMPLES_DIR.test(path) &&
    SRC_DIR.test(path)
  );
}

const NEWLINE = 0x0a;

/** 与 `wc -l` 相同：数换行符，最后一行没有换行就不算 */
export function countLines(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) if (b === NEWLINE) n++;
  return n;
}
