// 一道闸门管得到哪些执行路径、管不到哪些。写策略时最容易漏的不是规则，是路径。

export const SURFACES = ["model:bash", "model:write", "model:edit", "model:read", "user:bash", "extension-tools"] as const;
export type Surface = (typeof SURFACES)[number];

export interface GateProfile {
  readonly name: string;
  readonly source: string;
  /** confirm：执行前判断要不要放行；isolate：把执行挪到隔离环境里 */
  readonly kind: "confirm" | "isolate";
  readonly covers: readonly Surface[];
  /** 是否读项目目录里的配置；untrusted 表示读的时候不看项目有没有被信任 */
  readonly projectConfig: "none" | "trusted-only" | "tighten-only" | "untrusted";
  /** 闸门自己起不来或出错时，执行是被拦下（closed）还是照常进行（open）；按路径分开记 */
  readonly onFailure: Readonly<Partial<Record<Surface, "closed" | "open">>>;
}

export interface Gap {
  readonly severity: "高" | "中" | "低";
  readonly message: string;
}

function uncovered(profile: GateProfile): Gap[] {
  return SURFACES.filter((s) => !profile.covers.includes(s)).map((surface): Gap => {
    // 确认类闸门通常不拦读；隔离类不管读，密钥文件就还在模型够得着的地方
    if (surface === "model:read") return { severity: profile.kind === "isolate" ? "中" : "低", message: "不管 model:read" };
    if (surface === "extension-tools") return { severity: "中", message: "不管扩展自己注册的工具" };
    return { severity: "高", message: `不管 ${surface}` };
  });
}

export function gaps(profile: GateProfile): readonly Gap[] {
  const found: Gap[] = uncovered(profile);
  if (profile.projectConfig === "untrusted") found.push({ severity: "高", message: "项目配置不经信任检查、能放松限制" });
  for (const [surface, mode] of Object.entries(profile.onFailure)) {
    if (mode === "open") found.push({ severity: "高", message: `出错时 ${surface} 落回本机执行` });
  }
  const order = { 高: 0, 中: 1, 低: 2 };
  return found.toSorted((a, b) => order[a.severity] - order[b.severity]);
}

/** pi 仓库里四个示例扩展的画像；出处以 packages/coding-agent/examples/extensions/ 为根 */
export const PI_EXAMPLES: readonly GateProfile[] = [
  {
    name: "permission-gate",
    source: "permission-gate.ts:13-14",
    kind: "confirm",
    covers: ["model:bash"],
    projectConfig: "none",
    onFailure: { "model:bash": "closed" },
  },
  {
    name: "protected-paths",
    source: "protected-paths.ts:13-14",
    kind: "confirm",
    covers: ["model:write", "model:edit"],
    projectConfig: "none",
    onFailure: { "model:write": "closed", "model:edit": "closed" },
  },
  {
    name: "sandbox",
    source: "sandbox/index.ts:214-232",
    kind: "isolate",
    covers: ["model:bash", "user:bash"],
    projectConfig: "untrusted",
    onFailure: { "model:bash": "open", "user:bash": "open" },
  },
  {
    name: "gondolin",
    source: "gondolin/index.ts:443-520",
    kind: "isolate",
    covers: ["model:bash", "model:write", "model:edit", "model:read", "user:bash"],
    projectConfig: "none",
    onFailure: { "model:bash": "closed", "model:write": "closed", "model:edit": "closed", "model:read": "closed", "user:bash": "open" },
  },
];

export const THIS_EXAMPLE: GateProfile = {
  name: "本例",
  source: "src/hooks.ts",
  kind: "confirm",
  covers: ["model:bash", "model:write", "model:edit", "model:read", "user:bash", "extension-tools"],
  projectConfig: "tighten-only",
  onFailure: { "model:bash": "closed", "model:write": "closed", "model:edit": "closed", "user:bash": "closed" },
};
