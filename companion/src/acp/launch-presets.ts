// Per-agent launch argv templates (P1). Prompt is always also written to stdin.
// args may include {{prompt_file}} placeholder for agents that need a file path.

export type LaunchPreset = {
  /** Default argv when user/config does not specify args */
  args: string[]
  /** If true, append prompt as final argv element (after expanding placeholders) */
  append_prompt_arg?: boolean
  /** Prefer writing prompt to temp file and pass path */
  use_prompt_file?: boolean
}

/** Known CLI conventions — absolute paths still resolved by discover/config. */
export const LAUNCH_PRESETS: Record<string, LaunchPreset> = {
  claude: {
    // Claude Code non-interactive print mode (best-effort; stdin also fed)
    args: ["-p", "--output-format", "text"],
    append_prompt_arg: false,
  },
  gemini: {
    args: [],
    append_prompt_arg: false,
  },
  codex: {
    args: ["exec"],
    append_prompt_arg: false,
  },
  pi: {
    args: ["-p", "--no-session"],
    append_prompt_arg: false,
  },
  grok: {
    // Headless single-turn; prompt file avoids ARG_MAX / shell quoting
    args: ["--prompt-file", "{{prompt_file}}", "--output-format", "plain"],
    append_prompt_arg: false,
  },
  kimi: {
    // kimi -p cannot combine with -y/--auto (project knowledge).
    args: ["-p", "--output-format", "text"],
    append_prompt_arg: false,
  },
  opencode: {
    args: ["run"],
    append_prompt_arg: true,
  },
}

/**
 * Extra argv for the ACP JSON-RPC handshake (not the CLI-bridge fallback).
 * Only agents whose CLI needs a subcommand to speak ACP belong here.
 * Empty/omitted → spawn the binary with configured args or none (claude default).
 */
export const ACP_PROTOCOL_ARGS: Record<string, string[]> = {
  kimi: ["acp"],
  opencode: ["acp"],
}

/** Args for tryStartProtocolSession. Configured args win; else ACP subcommand preset. */
export function resolveProtocolArgs(
  agentId: string,
  configuredArgs: string[] | undefined,
): string[] {
  if (configuredArgs && configuredArgs.length > 0) return [...configuredArgs]
  const preset = ACP_PROTOCOL_ARGS[agentId]
  return preset ? [...preset] : []
}

function injectMissingFlagValue(args: string[], flags: string[], value: string): string[] {
  const out = [...args]
  for (const flag of flags) {
    const i = out.indexOf(flag)
    if (i < 0) continue
    const next = out[i + 1]
    if (!next || next.startsWith("-")) {
      out.splice(i + 1, 0, value)
    }
    return out
  }
  return out
}

export function resolveLaunchArgs(
  agentId: string,
  configuredArgs: string[] | undefined,
  opts: { prompt: string; promptFile: string },
): string[] {
  const preset = LAUNCH_PRESETS[agentId]
  const base =
    configuredArgs && configuredArgs.length > 0
      ? [...configuredArgs]
      : preset
        ? [...preset.args]
        : []
  const expanded = base.map((a) =>
    a
      .replace(/\{\{prompt_file\}\}/g, opts.promptFile)
      .replace(/\{\{prompt\}\}/g, opts.prompt.slice(0, 4000)),
  )
  if (preset?.append_prompt_arg || configuredArgs?.includes("{{prompt}}") === false) {
    if (preset?.append_prompt_arg) {
      expanded.push(opts.prompt)
    }
  }
  // claude / kimi: -p often wants the prompt as the next argv if not using stdin-only
  if (agentId === "claude" || agentId === "kimi") {
    return injectMissingFlagValue(expanded, ["-p", "--prompt"], opts.prompt)
  }
  return expanded
}
