// Shared types for Side Panel

export type ConnectionState = "connected" | "connecting" | "disconnected"

export type SkillSelectionMode = "auto" | "all" | "manual"

export type McpSelectionMode = "auto" | "all" | "manual"

export type McpTrustLevel = "manual" | "first-use" | "trusted"

export type McpTransportKind = "stdio" | "http"

/**
 * User-declarable security capability for an MCP server (mirrors
 * companion/src/security.ts McpDeclaredCapability = Exclude<McpCapability,"unknown">).
 * The 7 values a user may declare; "unknown" is not declarable. Used by the
 * §6.3 capability gate (Phase 2-B): declared caps merge with inferred caps via
 * a fail-safe union — a declaration can only escalate or resolve "unknown",
 * never suppress a positively-inferred critical capability.
 */
export type McpDeclaredCapability =
  | "file-read" | "file-write" | "exec" | "network-egress"
  | "db-read" | "db-mutate" | "read-only"

export type McpConnectionStatus = "disconnected" | "connecting" | "connected" | "error" | "dead"

export interface Thread {
  id: string
  alias: string
  created_at: string
  updated_at: string
  config_override: LLMConfig
  tool_whitelist: string[] | null
  pinned_tabs: number[]
  active_skill_ids: string[]
  skill_selection_mode?: SkillSelectionMode
  knowledge_selection_mode?: "auto" | "all" | "manual"
  mcp_selection_mode?: McpSelectionMode
  active_mcp_server_ids?: string[]
}

export interface McpToolMeta {
  name: string
  namespacedName: string
  description: string
  inputSchema: Record<string, any>
}

export interface McpResourceMeta {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpPromptMeta {
  name: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}

export interface McpConnectionState {
  status: McpConnectionStatus
  last_error?: string
  restart_count: number
  last_connected_at?: string
  pid?: number
}

export interface McpServerMeta {
  name: string
  transport: McpTransportKind
  enabled: boolean
  trust_level: McpTrustLevel
  connection: McpConnectionState
  capabilities: { tools: boolean; resources: boolean; prompts: boolean }
  server_info?: { name?: string; version?: string }
  tools: McpToolMeta[]
  resources: McpResourceMeta[]
  prompts: McpPromptMeta[]
  config: McpServerConfig
}

export interface McpStdioServerConfig {
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled: boolean
  trust_level: McpTrustLevel
  startup_timeout_ms?: number
  call_timeout_ms?: number
  /** §6.3 Phase 2-B: user-declared security capabilities. Optional — omit for
   *  pure inference (Phase 1 behavior). */
  security_capabilities?: McpDeclaredCapability[]
}

export interface McpHttpServerConfig {
  transport: "http"
  url: string
  headers?: Record<string, string>
  enabled: boolean
  trust_level: McpTrustLevel
  startup_timeout_ms?: number
  call_timeout_ms?: number
  /** §6.3 Phase 2-B: user-declared security capabilities. Optional — omit for
   *  pure inference (Phase 1 behavior). */
  security_capabilities?: McpDeclaredCapability[]
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

export interface LogEntry {
  ts: string
  level: "info" | "warn" | "error" | "debug"
  source: string
  event: string
  data: Record<string, any>
}

export type SendShortcut = "Enter" | "Cmd+Enter" | "Ctrl+Enter"

export interface LLMConfig {
  base_url: string
  api_key: string
  // True when companion reports a non-empty api_key (masked as "***"). Lets the
  // settings UI show "已配置 ✓" without ever exposing the real key.
  api_key_set?: boolean
  model_name: string
  temperature: number
  context_window: number
  trusted_domains: string[]
  safety_skills_enabled: string[]
  // Domains whose tool-call confirmations (evaluate, navigate, etc.) are auto-approved.
  // Flattened from companion config top-level `auto_approved_domains`.
  auto_approved_domains?: string[]
  // Global bypass for ALL dangerous tool confirmations. Flattened from companion
  // config `security.auto_approve_dangerous`. Default false.
  auto_approve_dangerous?: boolean
  // GOD-MODE: bypasses BOTH the URL-scheme hard-block (Layer 1) AND the dangerous-tool
  // confirmation gate (Layer 2). Strictly stronger than auto_approve_dangerous (L2 only).
  // Flattened from companion config `security.allow_all_schemes`. Default false.
  // UI enable requires a typed confirmation phrase (PR-B); gated behind PR-0 WS auth.
  allow_all_schemes?: boolean
  // Vision model fields (flattened for UI convenience)
  vision_enabled?: boolean
  vision_api_key?: string
  // True when companion reports a non-empty vision api_key (masked as "***").
  vision_api_key_set?: boolean
  vision_base_url?: string
  vision_model_name?: string
  vision_timeout_ms?: number
  vision_fallback?: "metadata" | "passthrough" | "error"
  // File upload fields (flattened from config.file_upload)
  file_upload_max_size?: number
  file_upload_max_tokens?: number
  file_upload_vision?: boolean
  // Obsidian export vault path (flattened from companion config.obsidian.vault_path)
  obsidian_vault_path?: string
  // Global MCP kill-switch (flattened from companion config.mcp.enabled).
  // When false, the McpManager refuses to start any client and listServers()
  // synthesizes disconnected metas — UI uses this to render the master toggle.
  mcp_enabled?: boolean
}

export interface Message {
  id: string
  thread_id: string
  role: "user" | "assistant" | "tool"
  content: string
  tool_calls?: ToolCall[]
  created_at: string
  streaming?: boolean
}

export interface SecurityConfirmationRequest {
  confirmation_id: string
  tool_name: string
  dangerous_apis: string[]
  code_preview: string
  timeout_ms?: number
  requested_at?: string
  risk_score?: number
  risk_category?: string
  risk_level?: "low" | "medium" | "high"
  auto_confirm_eligible?: boolean
  defense_layer?: number
  /**
   * Domains the user may add to auto_approved_domains when approving. Empty or
   * missing when companion couldn't determine the acting domain — UI hides the
   * "add to whitelist" option in that case.
   */
  relevant_domains?: string[]
  /**
   * Phase 1 W7 — bundle ids the user may add to thread-scoped trust when
   * approving. Empty/missing for non-host_use tools. UI shows inline checkbox
   * "信任此 app，本线程内不再询问" only for host_read (writes always biometric).
   */
  relevant_apps?: string[]
  /**
   * Phase 1 W9 — Linux manual nonce for biometric tier. 6-char code shown
   * prominently in dialog; user must TYPE it back in a paste-blocked input.
   * Round 2 §2.3 Kimi加严: 不可复制粘贴. Undefined on darwin (uses Touch ID).
   */
  nonce_challenge?: string
  /**
   * 坐标 computer-use(WP4)—— L2 确认对话框的标注截图(base64 JPEG,凭证区已
   * 黑化)。可选字段,旧 companion 不下发;存在且过 previewImageSafe 守卫时渲染。
   */
  preview_image?: string
  /** 截图说明行(三段式非绑定声明文案,companion 侧已做字符类清洗)。 */
  preview_caption?: string
  /**
   * P1:computer 类确认的完整预览文本独立字段——绕过 code_preview 的
   * CODE_PREVIEW_LIMIT=1200 截断,保证 30 动作 + 2000 语料逐字对人可见。
   * 存在时优先于 code_preview 渲染为可滚动区。
   */
  full_preview?: string
}

export interface ToolCall {
  id: string
  tool_name: string
  params: Record<string, any>
  result?: ToolResult | null
  status: "pending" | "running" | "success" | "error"
  vision_status?: "analyzing" | "done" | "cached" | "error"
  vision_latency_ms?: number
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
}

export interface FileAttachment {
  name: string
  type: string       // MIME type
  size: number
  content: string    // base64 encoded
}

export interface SkillMeta {
  name: string
  description: string
  type: "prompt_template" | "tool_chain" | "sub_agent" | "site_knowledge" | "domain_knowledge"
  builtin: boolean
  site?: string
  tags?: string[]
  entries?: Array<{
    id: string
    category: "problem" | "success" | "tip" | "rule"
    content: string
    recorded_at: string
    stale: boolean
    stale_reason: string
  }>
}

export interface KnowledgeMeta {
  name: string
  description: string
  type: "site_knowledge" | "domain_knowledge"
  site?: string
  builtin: boolean
  source_file?: string
}

export interface OperationRecord {
  id: number
  thread_id: string
  tool_name: string
  params: string
  result_summary: string
  error: string | null
  success: number
  duration_ms: number
  created_at: string
}

export interface SecurityAuditEntry {
  id: string
  ts: string
  level: "info" | "warn" | "error" | "block"
  tool_name: string
  // "allowed"/"denied"/"blocked" = a tool-gate decision (confirmation dialog).
  // "changed" = a security-setting change (e.g. god-mode armed/disarmed via UI phrase).
  // tool_name discriminates which setting (e.g. "allow_all_schemes" = the
  // design's godmode_enabled_changed event); `source` records the provenance.
  action: "allowed" | "denied" | "blocked" | "changed"
  risk_level: "low" | "medium" | "high"
  risk_score: number
  defense_layer?: number
  message: string
  // Provenance of a security-setting change (design §B godmode_enabled_changed).
  // "ui_phrase_confirmed" = armed/disarmed from this UI's typed-confirmation panel.
  // The other two originate companion-side (future live-bypass broadcast follow-up).
  source?: "ui_phrase_confirmed" | "config.json_manual" | "ws_authenticated"
}

// --- App tab (WP4) — mirrors companion/src/apps/types.ts ---
// The extension is a pure view: entries arrive via apps.list / apps.updated.

export type AppPolicy = "auto" | "ai" | "manual"

export interface AppExeBlock {
  path: string
  sha256?: string
  /** Authenticode signer captured at add-time; absent/empty = unsigned. */
  signer?: string
  user_writable_dir: boolean
}

export interface AppEntry {
  token: string
  kind: "gui" | "cli"
  display_name: string
  source: "preset" | "user"
  policy: AppPolicy
  enabled: boolean
  added_at: string
  exe?: AppExeBlock
  aumid?: string
  /** Policy ceiling attached by the backend (unsigned/user-writable/AUMID → "ai"). */
  max_policy?: "auto" | "ai"
  /**
   * 坐标 computer-use(WP4)—— UIA 探测能力提示(非权限位,WP3 §K.5):
   * true=支持 UIA 定位 / false=UIA 不可用走 OCR / undefined=未探测。
   * uiaCapable 有值但 uiaProbedAt 缺失 = 人工在 config.json 手设。
   */
  uiaCapable?: boolean
  uiaProbedAt?: string
  /** 坐标操作授权位(apps.set_coordinate_allowed,生物识别门在 companion 侧)。 */
  coordinateAllowed?: boolean
}

/** Preset detection status from apps.list (companion/src/apps/presets.ts). */
export interface AppPresetStatus {
  token: string
  display_name: string
  detected: boolean
  persisted: boolean
}

/** Candidate from apps.enumerate.result, annotated by the backend guards. */
export interface AppEnumerateCandidate {
  name: string
  source: "running" | "startapps"
  path?: string
  aumid?: string
  /** Hard-denied by the lolbin blocklist — UI shows the row disabled. */
  blocked: boolean
  block_reason?: "lolbin"
  /** Basename maps to a vault-blacklist app — allowed, but UI warns. */
  vault_token?: string
}

/** Warning returned with an apps.add response (D8 — rendered prominently). */
export interface AppAddWarning {
  code: string
  message: string
}

// --- 坐标 computer-use(WP4)— 镜像 companion/src/computer/preview.ts ---
// 扩展是纯视图:事件经 computer.task.event 广播到达,新增字段全部可选(向后兼容)。

/** 定位降级日志中的一条尝试记录(镜像 companion 证据链 locateAttempts 条目)。 */
export interface ComputerLocateAttemptView {
  layer?: string
  outcome?: string
  reason?: string
  durationMs?: number
}

/** computer.task.event 的下行负载(镜像 ComputerTaskEvent,含 WI-2 新增可选字段)。 */
export interface ComputerTaskEventView {
  event: "started" | "step" | "paused" | "finished"
  taskId: string
  /** started:目标应用显示名 + 任务文本。 */
  app?: string
  task?: string
  total?: number
  /** started:动作预算总量。 */
  budget?: number
  /** finished:结果。 */
  ok?: boolean
  completed?: number
  errorCode?: string
  /** finished:证据目录路径(companion 本地;仅用于展示/打开,扩展永不读字节)。 */
  evidenceDir?: string
  /** step/paused:1-based 动作序号。 */
  seq?: number
  action?: string
  x?: number
  y?: number
  budgetLeft?: number
  /** 人读短标签(如 点击「确定」),companion 侧已做字符类清洗。 */
  caption?: string
  /** base64 JPEG(after 帧标注图,凭证区已黑化;>300KB 扩展拒渲染)。 */
  previewImage?: string
  /** paused:re-L2 暂停原因。 */
  reason?: string
  /** step:实际命中的定位层(uia/ocr/…)。 */
  layer?: string
  confidence?: number
  durationMs?: number
  locateAttempts?: ComputerLocateAttemptView[]
  crossverified?: boolean
  crossverifyChannel?: string
}

/** 步骤时间线中的一行(折叠后的 step 事件)。 */
export interface ComputerStepView {
  seq: number
  action?: string
  caption?: string
  x?: number
  y?: number
  budgetLeft?: number
  previewImage?: string
  layer?: string
  confidence?: number
  durationMs?: number
  locateAttempts?: ComputerLocateAttemptView[]
  crossverified?: boolean
  crossverifyChannel?: string
}

/** store 中折叠后的任务状态(computerTask 切片),驱动任务条 + 急停按钮。 */
export interface ComputerTaskState {
  taskId: string
  app?: string
  task?: string
  total?: number
  budget?: number
  status: "running" | "paused" | "finished"
  /**
   * P4:面板迟连(错过 started)时由首个 step/paused 事件懒创建——任务条标
   * 「进行中(恢复同步)」;started 到达后转正常。急停按钮的存在性优先于事件流整洁性。
   */
  resyncing: boolean
  steps: ComputerStepView[]
  pauseReason?: string
  ok?: boolean
  completed?: number
  errorCode?: string
  evidenceDir?: string
  /** 急停 ack(matched>0)已收到——任务条置「已急停,等待任务退出…」态。 */
  abortAcked: boolean
  /** finished 到达时刻(ms 时间戳)——完结态保留 5s 再自动清空,由组件计时。 */
  finishedAt?: number
}

// --- WP5-I4 实验层模型态(镜像 companion model-handlers statePayload,plan:476 全形) ---

/** computer.model.state 下行负载(扩展纯只读镜像,无乐观更新)。 */
export interface ComputerModelState {
  modelEnabled: boolean
  licenseAccepted: boolean
  licenseAcceptedAt?: string
  modelLicenseDeclined: boolean
  /** absent=未下载 / error=半成品或校验失败 / ready=在盘就绪 /
   *  downloading=下载中 / disabled=熔断停用 */
  modelStatus: string
  variant: string
  sizeBytes?: number
  /** I1 词表 reason(model-file-missing 等;MODEL_STATE_MESSAGES 消费) */
  error?: string
  faults: number
}

/** computer.model.progress 下行负载(单文件下载进度;state 广播到达后由 reducer 清理)。 */
export interface ComputerModelProgress {
  variant: string
  file: string
  receivedBytes: number
  totalBytes: number
}

/** computer.model.license_required 下行负载(许可证门;渲染原文,扩展不复制不私编)。 */
export interface ComputerModelLicenseDoor {
  licenseText: string
  notice: string
}
