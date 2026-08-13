// ACP (Agent Client Protocol) composition client — types.
// Product SoT: docs/decisions/acp-coding-handoff-product-design-2026-08-13.md
// ADR: docs/adr/025-acp-coding-agent-client.md

export type AcpPolicyProfile = "review_readonly" | "propose_diff" | "agent_default"

export interface AcpAgentServerConfig {
  enabled: boolean
  display_name: string
  transport: "stdio"
  /**
   * Protocol dialect:
   * - auto: try ACP JSON-RPC initialize, else CLI prompt bridge
   * - acp: require JSON-RPC ACP
   * - cli: fire-and-forget / stdin prompt (legacy bridge)
   */
  protocol?: "auto" | "acp" | "cli"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  policy: {
    profile: AcpPolicyProfile
    session_timeout_ms?: number
    max_handback_chars?: number
    allow_write?: boolean
    allow_exec?: boolean
  }
  startup_timeout_ms?: number
}

export interface AcpConfig {
  /** Master switch — default false (non default-on). */
  enabled: boolean
  servers: Record<string, AcpAgentServerConfig>
  policy: {
    require_workspace: boolean
    force_confirm_session_start: boolean
    default_profile: AcpPolicyProfile
  }
}

export type AcpSessionState =
  | "idle"
  | "offered"
  | "confirmed"
  | "running"
  | "handback"
  | "closed"

/** Session run mode (runtime; not free shell). */
export type AcpSessionMode = "review_readonly" | "propose_diff"

export interface AcpPendingDiff {
  relPath: string
  isNew: boolean
  isDelete: boolean
  /** Full new content if reconstructable (new files) */
  newContent: string | null
  hunk: string
  /** Structured hunks for safe apply on existing files */
  hunks?: import("./diff-apply").DiffHunk[]
}

export interface AcpSessionRecord {
  session_id: string
  thread_id: string
  agent_id: string
  state: AcpSessionState
  workspace_root: string
  profile: AcpPolicyProfile
  /** Runtime mode for this session (propose_diff enables parse+apply path). */
  mode: AcpSessionMode
  goal: string
  created_at: string
  partial: boolean
  handback_text?: string
  error?: string
  pid?: number
  parent_session_id?: string
  pending_diffs?: AcpPendingDiff[]
  diff_summary?: string
  /** How this session is talking to the agent process */
  transport?: "acp" | "cli"
  /** Agent-side session id (ACP session/new) */
  agent_session_id?: string
  /** Live timeline for browser session shell */
  timeline?: import("./timeline").TimelineItem[]
  /** Accumulated agent text for handback */
  agent_text?: string
  /** Page context injected at start (URL/title/repo hint) */
  page_context?: string
}

export const DEFAULT_ACP_CONFIG: AcpConfig = {
  enabled: false,
  servers: {},
  policy: {
    require_workspace: true,
    force_confirm_session_start: true,
    default_profile: "review_readonly",
  },
}

export function sanitizeAcpConfig(raw: unknown): AcpConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_ACP_CONFIG, servers: {} }
  }
  const r = raw as Record<string, unknown>
  const serversIn =
    r.servers && typeof r.servers === "object" && !Array.isArray(r.servers)
      ? (r.servers as Record<string, unknown>)
      : {}
  const servers: Record<string, AcpAgentServerConfig> = {}
  for (const [id, v] of Object.entries(serversIn)) {
    if (id === "__proto__" || id === "constructor" || id === "prototype") continue
    if (!v || typeof v !== "object") continue
    const s = v as Record<string, unknown>
    const policyRaw =
      s.policy && typeof s.policy === "object" ? (s.policy as Record<string, unknown>) : {}
    // Phase B product lock: always coerce to review_readonly at config boundary
    // (Pi dual-review B/N2 — do not trust hand-edited propose_diff + allow_write).
    const profile: AcpPolicyProfile = "review_readonly"
    const allow_write = false
    const allow_exec = false // never in v1
    servers[id] = {
      enabled: s.enabled !== false,
      display_name: typeof s.display_name === "string" ? s.display_name : id,
      transport: "stdio",
      command: typeof s.command === "string" ? s.command : "",
      args: Array.isArray(s.args) ? s.args.map(String) : [],
      env:
        s.env && typeof s.env === "object" && !Array.isArray(s.env)
          ? Object.fromEntries(
              Object.entries(s.env as Record<string, unknown>).map(([k, val]) => [k, String(val)]),
            )
          : undefined,
      cwd: typeof s.cwd === "string" ? s.cwd : undefined,
      policy: {
        profile,
        session_timeout_ms:
          typeof policyRaw.session_timeout_ms === "number"
            ? policyRaw.session_timeout_ms
            : 15 * 60_000,
        max_handback_chars:
          typeof policyRaw.max_handback_chars === "number" ? policyRaw.max_handback_chars : 48_000,
        allow_write,
        allow_exec,
      },
      startup_timeout_ms:
        typeof s.startup_timeout_ms === "number" ? s.startup_timeout_ms : 30_000,
    }
  }
  const policyIn =
    r.policy && typeof r.policy === "object" ? (r.policy as Record<string, unknown>) : {}
  return {
    enabled: r.enabled === true,
    servers,
    policy: {
      require_workspace: policyIn.require_workspace !== false,
      force_confirm_session_start: policyIn.force_confirm_session_start !== false,
      default_profile: "review_readonly",
    },
  }
}
