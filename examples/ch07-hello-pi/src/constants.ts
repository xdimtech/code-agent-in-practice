/** 环境变量名与默认路径。每一条都能在 pi 里找到出处，改动时一起改注释。 */

/** config.ts:503-504 —— `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`。 */
export const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";
/** config.ts:529 —— 默认 agent 目录是 `<home>/.pi/agent`。CONFIG_DIR_NAME 在 config.ts:500。 */
export const CONFIG_DIR_NAME = ".pi";
export const DEFAULT_AGENT_SUBDIR = "agent";

/** docs/environment-variables.md —— 这些名字进 pi 之后会让它少做或不做某些事。 */
export const ENV_FLAGS = [
	"PI_OFFLINE",
	"PI_SKIP_VERSION_CHECK",
	"PI_TELEMETRY",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_SESSION_ID",
	"PI_MODEL",
	"PI_PROVIDER",
	"AI_AGENT",
] as const;

/**
 * ai/src/env-api-keys.ts:79-116 的 envMap 里的一部分。
 * 名字照抄，值不抄：这本书里只出现变量名，不出现变量值。
 */
export const PROVIDER_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"DEEPSEEK_API_KEY",
	"GROQ_API_KEY",
	"XAI_API_KEY",
	"OPENROUTER_API_KEY",
	"MOONSHOT_API_KEY",
	"ZAI_API_KEY",
	"MINIMAX_API_KEY",
] as const;

/** pi 根 package.json:62-63 与 packages/coding-agent/package.json:103-104 的 engines.node。 */
export const MIN_NODE = [22, 19, 0] as const;

/** 本书的 pi 基线。你装的版本可能比它新，doctor 会把两个都打出来。 */
export const BASELINE_PI_VERSION = "0.84.4";

/** agent 目录里 pi 自己写的文件，以及它们应有的权限。 */
export const AGENT_DIR_FILES = [
	{ name: "auth.json", private: true },
	{ name: "models-store.json", private: true },
	{ name: "trust.json", private: true },
	{ name: "settings.json", private: false },
] as const;
