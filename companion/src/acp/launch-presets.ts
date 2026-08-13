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
  // claude -p often wants prompt as next arg if not using stdin-only
  if (agentId === "claude" && expanded.includes("-p")) {
    const i = expanded.indexOf("-p")
    const next = expanded[i + 1]
    if (!next || next.startsWith("-")) {
      expanded.splice(i + 1, 0, opts.prompt)
    }
  }
  return expanded
}
