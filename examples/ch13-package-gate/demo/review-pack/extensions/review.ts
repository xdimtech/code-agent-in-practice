// 演示用：注册一个 /review 命令
export default function (pi: { registerCommand(name: string, spec: unknown): void }) {
  pi.registerCommand("review", { description: "审查当前改动" });
}
