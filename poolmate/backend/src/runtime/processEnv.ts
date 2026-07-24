const AGENT_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TERM",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CODEX_HOME",
  "CODEX_API_KEY",
  "OPENAI_API_KEY"
] as const;

export function buildAgentProcessEnv(
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of AGENT_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }

  return environment;
}
