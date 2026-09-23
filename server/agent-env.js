// opencode（含改名的 nga）等 agent 命令启动时统一注入的额外环境变量。
// OPENCODE_SKIP_SAFE_CHECK=1：跳过 opencode 启动时的安全校验（如 stats / run / 交互会话）。
export const AGENT_ENV = { OPENCODE_SKIP_SAFE_CHECK: '1' };

// 在给定 env（默认 process.env）基础上并入 AGENT_ENV。
export function withAgentEnv(env = process.env) {
  return { ...env, ...AGENT_ENV };
}
