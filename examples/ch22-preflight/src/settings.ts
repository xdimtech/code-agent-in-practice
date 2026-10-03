/**
 * 读 pi 的 settings.json 里本例用得到的三项。
 *
 *   npmCommand          pi install 用哪个包管理器、带什么参数（core/settings-manager.ts:989）
 *   shellPath           bash 工具和 `!` 用哪个 shell（:947）
 *   shellCommandPrefix  每条命令前面加的那几行（:979）
 *
 * 后两项是覆盖 bash 工具时必须原样带过去的：pi 造内置 bash 时传了它们（core/agent-session.ts:2774），
 * 同名覆盖之后由我们来造，不带就悄悄丢了用户的设置。
 *
 * 文件是用户写的：解析失败、类型不对都直接报错，不当作「没设」。
 */

export interface PiSettings {
	readonly npmCommand?: readonly string[];
	readonly shellPath?: string;
	readonly shellCommandPrefix?: string;
}

function optionalString(record: Record<string, unknown>, name: keyof PiSettings): string | undefined {
	const value = record[name];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} 必须是非空字符串`);
	return value;
}

export function parseSettings(text: string): PiSettings {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new TypeError(`settings.json 不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError("settings.json 顶层必须是对象");
	const record = parsed as Record<string, unknown>;
	const npmCommand = record.npmCommand;
	if (npmCommand !== undefined && (!Array.isArray(npmCommand) || npmCommand.length === 0 || !npmCommand.every((item) => typeof item === "string" && item.length > 0))) {
		throw new TypeError("npmCommand 必须是非空字符串组成的非空数组");
	}
	const shellPath = optionalString(record, "shellPath");
	const shellCommandPrefix = optionalString(record, "shellCommandPrefix");
	return {
		...(npmCommand === undefined ? {} : { npmCommand: npmCommand as string[] }),
		...(shellPath === undefined ? {} : { shellPath }),
		...(shellCommandPrefix === undefined ? {} : { shellCommandPrefix }),
	};
}
