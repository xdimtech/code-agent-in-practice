/**
 * 沙箱根目录的展示与抹平。
 *
 * 每次运行的临时目录名都是新的（`mkdtemp` 加了随机后缀），所以轨迹里出现的绝对路径
 * 天然带噪声。两种处理方式各有代价：
 *
 *   不抹：两次运行的文件名永远对不上，轨迹只能人工看
 *   抹：万一抹掉了不该抹的前缀，两次本该不同的运行看起来一样了
 *
 * 这里的做法是「抹，但默认不抹」——TRACE_OPTIONS 的 root 是空的，只有调用方明确
 * 传进来才生效（compare 里就是这么用的）。默认安全，效果靠显式开启。
 */

import { resolve } from "node:path";

export const ROOT_PLACEHOLDER = "<root>";

/**
 * 把路径里的根目录前缀换成 `<root>`。
 *
 * 只换前缀，不换中间片段：`/tmp/abc/x/tmp/abc/y` 抹 `/tmp/abc` 之后是
 * `<root>/x/tmp/abc/y`，中间那段留着——它是路径内容的一部分，抹掉就等于篡改轨迹。
 * 反过来只认开头也有代价：嵌在长文本中间的同名前缀不会被动到，但那种情况
 * 本来就该由调用方决定要不要抹，不该由这里替它猜。
 */
export function stripRoot(path: string, root: string): string {
	if (root === "") return path;
	if (path === root) return ROOT_PLACEHOLDER;
	if (path.startsWith(`${root}/`)) return `${ROOT_PLACEHOLDER}${path.slice(root.length)}`;
	// Windows 写法：前缀反斜杠，末尾也不带斜杠
	const windows = root.split("/").join("\\");
	if (path.startsWith(`${windows}\\`)) return `${ROOT_PLACEHOLDER}${path.slice(windows.length)}`;
	return path;
}

/** 抹平一个根目录，顺便把它自己也算出来，省得调用方两边都写 */
export function rootOf(directory: string): string {
	return resolve(directory);
}
