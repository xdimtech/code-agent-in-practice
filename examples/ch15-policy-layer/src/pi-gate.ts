// pi 自带的两个示例扩展里的判断逻辑，原样搬过来当对照组。
// 它们是讲解钩子怎么用的教学示例，不是 pi 的产品功能；拿来对照是为了看清「策略」这件事有多少细节。

/** examples/extensions/permission-gate.ts:11 */
export const PI_DANGEROUS_PATTERNS: readonly RegExp[] = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];

/** examples/extensions/permission-gate.ts:17 */
export const piGateFlags = (command: string): boolean => PI_DANGEROUS_PATTERNS.some((p) => p.test(command));

/** examples/extensions/protected-paths.ts:11 */
export const PI_PROTECTED_PATHS: readonly string[] = [".env", ".git/", "node_modules/"];

/** examples/extensions/protected-paths.ts:19 —— 子串匹配 */
export const piPathProtected = (path: string): boolean => PI_PROTECTED_PATHS.some((p) => path.includes(p));
