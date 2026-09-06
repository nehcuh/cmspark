// 场景与专家 panel (Mission Packs + #369 expert segment) — product rename from「任务包」.
// SoT: docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md
// Zones: 本对话状态 · 场景模板（含用户可配 system prompt/skills/MCP）· 本机能力
// #369: 分段「场景 | 专家」；专家 = kind:expert 的 pack（builtin 只读，用户专家 CRUD）。

import { useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { useContextPanelHostOptional } from "./ContextPanelHost"
import {
  DISTILL_ALL_ENTRY_LABEL,
  DISTILL_DISARM_LABEL,
  DISTILL_DRAIN_LABEL,
  DISTILL_ENTRY_LABEL,
  DISTILL_LLM_NOTICE,
  DISTILL_RESTART_LOSS_NOTE,
  DISTILL_SUGGESTED_TOOLS_LABEL,
  EXPERT_EMPTY_COPY,
  EXPERT_PRIMARY_CTA_DISABLED_HINT,
  EXPERT_PRIMARY_CTA_LABEL,
  EXPERT_SECONDARY_CTA_LABEL,
  EXPERT_SEGMENT_HINT,
  PANEL_TITLE,
  distillAllConfirmBody,
  distillAllQueueLine,
  distillAllQueueStep,
  distillSourceLabel,
  distillStatusLine,
  expertCardActions,
  formatEffectiveToolsLine,
  formatUsageLine,
  isUserPack,
  normalizeDistillAllDrafts,
  normalizeDistillPreview,
  segmentPacks,
  type DistillAllDraftView,
  type DistillMeta,
  type DistillStatusView,
  type PackSegment,
} from "../packs-panel-logic"

// Lock-step with companion/src/security-arm.ts SECURITY_ARM_CONFIRM_PHRASE (C5 multi-adv).
// Pack Trust skip_l2 / auto_approve writes durable cruise flags — NOT 无人值守 arm —
// but still requires the same phrase step-up as Settings.
const SECURITY_ARM_CONFIRM_PHRASE = "我了解风险"

export type PackListItem = {
  id: string
  name: string
  description?: string
  version: string
  channel: string
  /** #367: mission|expert (companion always sends it; absent = mission). */
  kind?: "mission" | "expert"
  /** #369: operator-disabled — propose/apply/spawn refuse; editor read-only. */
  disabled?: boolean
  min_capability?: string
  requires_modules?: string[]
  apply_blocked?: string | null
  suitable_for?: string
  unsuitable_for?: string
  tools_summary_zh?: string
  origin?: "builtin" | "installed" | "user"
  skill_refs?: string[]
  mcp_servers?: string[]
  editable?: boolean
  /** Pack writes global security on apply (Trust B) */
  has_trust?: boolean
  trust_skip_l2?: boolean
}

/** C5: client-side gate — server also rejects missing phrase when cruise flags write. */
function packNeedsTrustPhrase(p: Pick<PackListItem, "has_trust" | "trust_skip_l2"> | null): boolean {
  return !!(p?.trust_skip_l2 || p?.has_trust)
}

type ModuleStateView = {
  available?: boolean
  enabled?: boolean
  target_allowlist?: string[]
  require_task_auth?: boolean
}

type SkillOption = { name: string; description?: string }
type McpOption = { name: string; status?: string; enabled?: boolean }

type ToolsModeUi = "unchanged" | "allowlist"

/** Trust single-holder conflict — offer one-click unlock + apply. */
type TrustHolderInfo = {
  id: string
  pack_id: string | null
  alias: string | null
}

type TrustConflictState = {
  packId: string
  packName: string
  threadId: string
  holders: TrustHolderInfo[]
  error: string
}

/** Curated native tools for scene allowlist UI (P0 static groups). */
const SCENE_TOOL_GROUPS: Array<{ title: string; highRisk?: boolean; tools: string[] }> = [
  {
    title: "浏览 / 页面",
    tools: [
      "list_tabs",
      "create_tab",
      "switch_tab",
      "close_tab",
      "navigate",
      "get_page_text",
      "get_page_html",
      "screenshot",
      "click",
      "type_text",
      "use_skill",
    ],
  },
  {
    title: "高危 / 企业（需本机模块；默认每次确认；若场景勾选 Trust 跳过 L2 则应用后可免确认）",
    highRisk: true,
    tools: [
      "shell_exec",
      "evaluate",
      "osascript_eval",
      "host_computer",
      "host_cli",
      "host_app",
      "netsec_port_scan",
      "workspace_list_dir",
      "workspace_read_file",
    ],
  },
]

type SceneEditorState = {
  /** null = create; string = edit existing user pack id */
  id: string | null
  /** #369: expert saves write kind=expert via pack.save_user */
  kind: "mission" | "expert"
  /** #369: builtin 查看 / 停用包 — 只读打开，不出保存按钮 */
  readOnly: boolean
  name: string
  description: string
  system_prompt_append: string
  skill_ids: string[]
  /** Wave A: global knowledge doc names for apply */
  knowledge_ids: string[]
  mcp_server_ids: string[]
  tools_mode: ToolsModeUi
  tools_allow: string[]
  /** Clone: copy source pack tools into save payload */
  preserve_tools: boolean
  /** Product B: global Trust on apply */
  trust_skip_l2: boolean
  trust_enable_modules: boolean
  trust_auto_approve_dangerous: boolean
  trust_auto_approve_enterprise: boolean
  trust_allow_all_schemes: boolean
}

const emptyEditor = (): SceneEditorState => ({
  id: null,
  kind: "mission",
  readOnly: false,
  name: "",
  description: "",
  system_prompt_append: "",
  skill_ids: [],
  knowledge_ids: [],
  mcp_server_ids: [],
  tools_mode: "unchanged",
  tools_allow: [],
  preserve_tools: false,
  trust_skip_l2: false,
  trust_enable_modules: false,
  trust_auto_approve_dangerous: false,
  trust_auto_approve_enterprise: false,
  trust_allow_all_schemes: false,
})

/** Prefer pack.yaml ui.*; AppSec hardcopy fallback if installed pack lacks ui. */
function sceneCopy(p: PackListItem): { suitable: string; unsuitable: string; tools: string } | null {
  if (p.suitable_for || p.unsuitable_for || p.tools_summary_zh) {
    return {
      suitable: p.suitable_for || p.description || "",
      unsuitable: p.unsuitable_for || "",
      tools: p.tools_summary_zh || "",
    }
  }
  if (p.id !== "appsec-prd-review") return null
  return {
    suitable: "对当前网页/PRD 做威胁建模与安全 checklist；只读浏览与截图。",
    unsuitable: "安装技能、读写本机项目、需要全部浏览器工具或脚本执行。",
    tools: "列出标签、打开页面、读取页面文字/HTML、截图、使用技能",
  }
}

export function PacksPanel() {
  const { state, dispatch } = useAgentStore()
  const host = useContextPanelHostOptional()
  const hostRef = useRef(host)
  hostRef.current = host
  const [packs, setPacks] = useState<PackListItem[]>([])
  const [modules, setModules] = useState<Record<string, ModuleStateView>>({})
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmPack, setConfirmPack] = useState<PackListItem | null>(null)
  const [trustPhrase, setTrustPhrase] = useState("")
  const [trustConflict, setTrustConflict] = useState<TrustConflictState | null>(null)
  const [editor, setEditor] = useState<SceneEditorState | null>(null)
  /** Phrase for save+apply path when editor Trust writes cruise flags. */
  const [editorTrustPhrase, setEditorTrustPhrase] = useState("")
  const [skillOptions, setSkillOptions] = useState<SkillOption[]>([])
  const [mcpOptions, setMcpOptions] = useState<McpOption[]>([])
  /** After pack.saved_user, apply to this thread (also sent as apply_thread_id). */
  const pendingApplyThreadRef = useRef<string | null>(null)
  /** Last pack.apply target — used to open Trust conflict dialog with names. */
  const pendingApplyRef = useRef<{ packId: string; packName: string; threadId: string } | null>(
    null,
  )
  /** pack.get mode: edit existing user pack vs clone builtin into new user scene. */
  const packGetModeRef = useRef<"edit" | "clone" | "view" | "toggle-disabled">("edit")
  /** #369: 分段（场景 | 专家）与专家面板数据（有效工具面 + 用量）。 */
  const [segment, setSegment] = useState<PackSegment>("scene")
  const [expertInfo, setExpertInfo] = useState<
    Record<string, { effective_tools: string[]; spawn_count: number; last_spawn_at: string | null }>
  >({})
  /** Source tools when cloning (for「保留原场景工具限制」). */
  const cloneToolsRef = useRef<{ mode: ToolsModeUi; allow: string[] } | null>(null)
  const [suggestNote, setSuggestNote] = useState<string>("")
  /** #370: 本对话归纳草稿的来源横幅（AI / 启发式）+ 证据 + 建议工具（不预勾）。 */
  const [distillMeta, setDistillMeta] = useState<DistillMeta | null>(null)
  /** #370: armed 队列状态（默认 off；重启丢未审草稿的提示常驻）。 */
  const [distillStatus, setDistillStatus] = useState<DistillStatusView | null>(null)
  const [distillRestartNote, setDistillRestartNote] = useState<string>(DISTILL_RESTART_LOSS_NOTE)
  /**
   * #411 全历史归纳：count → 一次性确认弹窗（N + 排除项）→ 扫描 → 草稿队列
   * （上一份/下一份逐份进同一编辑器；草稿只在内存，保存仍走手动 pack.save_user）。
   */
  const [distillAllConfirm, setDistillAllConfirm] = useState<{
    eligible: number
    with_digest: number
    capped: boolean
    /** "all" | 天数（ISO 截止 = now - N 天）。 */
    since: string
    keyword: string
  } | null>(null)
  const [distillAllQueue, setDistillAllQueue] = useState<{
    drafts: DistillAllDraftView[]
    index: number
    scanned: number
  } | null>(null)
  const activeThreadRef = useRef(state.activeThreadId)
  activeThreadRef.current = state.activeThreadId

  const openTrustConflict = (
    packId: string,
    packName: string,
    threadId: string,
    holders: TrustHolderInfo[],
    error: string,
  ) => {
    setTrustConflict({ packId, packName, threadId, holders, error })
    setBusy(null)
    setConfirmPack(null)
  }

  const activeThread = (state.threads || []).find((t: any) => t.id === state.activeThreadId)
  const workspaceRoot = (activeThread as any)?.workspace_root as string | undefined

  const flash = (msg: string, ms = 3500) => {
    setStatus(msg)
    setTimeout(() => setStatus(""), ms)
  }

  const refresh = () => {
    chrome.runtime.sendMessage({ type: "pack.list" })
    chrome.runtime.sendMessage({ type: "modules.list" })
    chrome.runtime.sendMessage({ type: "skill.list" })
    chrome.runtime.sendMessage({ type: "mcp.list" })
    // #369: 有效工具面相对当前对话计算；无对话时 companion 以 null parent 计算
    chrome.runtime.sendMessage({
      type: "pack.expert_panel",
      thread_id: activeThreadRef.current || undefined,
    })
    // #370: 队列状态只读拉取（无 gesture 要求；armed 默认 off 由服务端保证）
    chrome.runtime.sendMessage({ type: "pack.distill_status" })
  }

  useEffect(() => {
    refresh()
    const handler = (msg: any) => {
      if (msg?.type === "pack.list" && Array.isArray(msg.packs)) {
        setPacks(msg.packs)
      }
      if (msg?.type === "pack.expert_panel" && Array.isArray(msg.experts)) {
        const next: Record<
          string,
          { effective_tools: string[]; spawn_count: number; last_spawn_at: string | null }
        > = {}
        for (const e of msg.experts) {
          if (!e || typeof e.id !== "string") continue
          next[e.id] = {
            effective_tools: Array.isArray(e.effective_tools) ? e.effective_tools : [],
            spawn_count: typeof e.spawn_count === "number" ? e.spawn_count : 0,
            last_spawn_at: typeof e.last_spawn_at === "string" ? e.last_spawn_at : null,
          }
        }
        setExpertInfo(next)
      }
      if (msg?.type === "pack.installed" || msg?.type === "pack.uninstalled" || msg?.type === "pack.saved_user" || msg?.type === "pack.deleted_user") {
        if (Array.isArray(msg.packs)) setPacks(msg.packs)
        else refresh()
        if (msg?.type === "pack.saved_user") {
          setBusy(null)
          setEditor(null)
          setSuggestNote("")
          setDistillMeta(null)
          if (msg.applied && msg.thread?.id) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
            flash(msg.id ? `已保存并用于本对话：${msg.id}` : "已保存并用于本对话", 3000)
            pendingApplyThreadRef.current = null
            pendingApplyRef.current = null
          } else if (msg.apply_error) {
            pendingApplyThreadRef.current = null
            const holders = Array.isArray(msg.holders) ? (msg.holders as TrustHolderInfo[]) : []
            if (
              msg.apply_code === "trust_holder_conflict" &&
              holders.length > 0 &&
              msg.id &&
              pendingApplyRef.current
            ) {
              const pend = pendingApplyRef.current
              pendingApplyRef.current = null
              openTrustConflict(
                msg.id,
                pend.packName || msg.id,
                pend.threadId,
                holders,
                String(msg.apply_error),
              )
            } else {
              pendingApplyRef.current = null
              flash(`场景已保存，但应用失败：${msg.apply_error}`, 5000)
            }
          } else if (pendingApplyThreadRef.current && msg.id) {
            // Fallback if server ignored apply_thread_id
            const tid = pendingApplyThreadRef.current
            pendingApplyThreadRef.current = null
            const pend = pendingApplyRef.current
            pendingApplyRef.current = {
              packId: msg.id,
              packName: pend?.packName || msg.id,
              threadId: tid,
            }
            chrome.runtime.sendMessage({
              type: "pack.apply",
              pack_id: msg.id,
              thread_id: tid,
              user_gesture: true,
            })
            flash(msg.id ? `场景已保存，正在用于本对话…` : "场景已保存", 2500)
          } else {
            pendingApplyRef.current = null
            flash(msg.id ? `场景已保存：${msg.id}` : "场景已保存", 2500)
          }
        }
        if (msg?.type === "pack.deleted_user") {
          flash("已删除用户场景", 2500)
          setBusy(null)
          setEditor(null)
        }
      }
      if (msg?.type === "pack.get" && msg.pack) {
        const p = msg.pack
        const mode = packGetModeRef.current
        packGetModeRef.current = "edit"
        if (mode === "toggle-disabled") {
          // #369: 停用/启用 = pack.save_user 只翻转 disabled（其余字段原样回写；
          // save_user 对省略字段保留，但 name/prompt 必填故带上原值）。
          const t = p.tools || { mode: "unchanged", allow: [], deny: [] }
          chrome.runtime.sendMessage({
            type: "pack.save_user",
            user_gesture: true,
            id: p.id,
            name: p.name || p.id,
            description: p.description || undefined,
            system_prompt_append: p.system_prompt_append || "",
            kind: p.kind === "expert" ? "expert" : "mission",
            disabled: p.disabled !== true,
            skill_ids: Array.isArray(p.skill_refs) ? p.skill_refs : [],
            knowledge_ids: Array.isArray(p.knowledge_refs) ? p.knowledge_refs : [],
            mcp_server_ids: Array.isArray(p.mcp_servers) ? p.mcp_servers : [],
            tools: {
              mode: t.mode === "allowlist" || t.mode === "intersect" ? t.mode : "unchanged",
              allow: Array.isArray(t.allow) ? t.allow : [],
              deny: Array.isArray(t.deny) ? t.deny : [],
            },
            trust: p.trust === null || p.trust === undefined ? undefined : p.trust,
          })
          setBusy(null)
          flash(p.disabled === true ? "正在启用…" : "正在停用…", 2000)
        } else if (mode === "clone") {
          // 另存为我的：default 不收窄工具；用户可勾「保留工具限制」
          const refs = Array.isArray(p.skill_refs) ? p.skill_refs : []
          const installed = Array.isArray(p.installed_skill_ids) ? p.installed_skill_ids : []
          const kRefs = Array.isArray(p.knowledge_refs) ? p.knowledge_refs : []
          const kInstalled = Array.isArray(p.installed_knowledge_ids) ? p.installed_knowledge_ids : []
          const srcTools = p.tools || { mode: "unchanged", allow: [], deny: [] }
          const srcMode: ToolsModeUi = srcTools.mode === "allowlist" ? "allowlist" : "unchanged"
          const srcAllow = Array.isArray(srcTools.allow) ? [...srcTools.allow] : []
          cloneToolsRef.current = { mode: srcMode, allow: srcAllow }
          setEditor({
            ...emptyEditor(),
            id: null,
            kind: p.kind === "expert" ? "expert" : "mission",
            name: `${p.name || "场景"}（我的）`,
            description: p.description || "",
            system_prompt_append: p.system_prompt_append || "",
            skill_ids: [...new Set([...refs, ...installed])],
            knowledge_ids: [...new Set([...kRefs, ...kInstalled])],
            mcp_server_ids: Array.isArray(p.mcp_servers) ? p.mcp_servers : [],
            tools_mode: "unchanged",
            tools_allow: srcAllow,
            preserve_tools: false,
          })
          setSuggestNote(
            "已从模板复制。默认不额外限制工具（可勾「保留原场景工具限制」）。可改 prompt / 技能 / 知识库 / Trust 后保存。",
          )
        } else {
          cloneToolsRef.current = null
          const t = p.tools || { mode: "unchanged", allow: [] }
          const tr = p.trust || {}
          const kRefs = Array.isArray(p.knowledge_refs) ? p.knowledge_refs : []
          const kInstalled = Array.isArray(p.installed_knowledge_ids) ? p.installed_knowledge_ids : []
          setEditor({
            ...emptyEditor(),
            id: p.id,
            kind: p.kind === "expert" ? "expert" : "mission",
            // #369: 查看模式（builtin 只读）与停用包都只读打开
            readOnly: mode === "view" || p.disabled === true,
            name: p.name || "",
            description: p.description || "",
            system_prompt_append: p.system_prompt_append || "",
            skill_ids: Array.isArray(p.skill_refs) ? p.skill_refs : [],
            knowledge_ids: [...new Set([...kRefs, ...kInstalled])],
            mcp_server_ids: Array.isArray(p.mcp_servers) ? p.mcp_servers : [],
            tools_mode: t.mode === "allowlist" ? "allowlist" : "unchanged",
            tools_allow: Array.isArray(t.allow) ? [...t.allow] : [],
            preserve_tools: false,
            trust_skip_l2: tr.skip_l2 === true,
            trust_enable_modules: Array.isArray(tr.enable_modules) && tr.enable_modules.length > 0,
            trust_auto_approve_dangerous: tr.auto_approve_dangerous === true,
            trust_auto_approve_enterprise: tr.auto_approve_enterprise_tools === true,
            trust_allow_all_schemes: tr.allow_all_schemes === true,
          })
          setSuggestNote("")
        }
        setBusy(null)
      }
      if (msg?.type === "pack.suggest_config" && msg.suggestion) {
        const s = msg.suggestion
        const smode = s.mode || "recommend"
        setEditor((prev) => {
          if (!prev) return prev
          if (smode === "optimize") {
            const nextPrompt =
              typeof s.system_prompt_append === "string" && s.system_prompt_append.trim()
                ? s.system_prompt_append
                : prev.system_prompt_append
            return { ...prev, system_prompt_append: nextPrompt }
          }
          const nextSkills = Array.isArray(s.skill_ids) ? s.skill_ids : []
          const nextMcp = Array.isArray(s.mcp_server_ids) ? s.mcp_server_ids : []
          const skill_ids = [...new Set([...prev.skill_ids, ...nextSkills])]
          const mcp_server_ids = [...new Set([...prev.mcp_server_ids, ...nextMcp])]
          let system_prompt_append = prev.system_prompt_append
          if (typeof s.system_prompt_append === "string" && s.system_prompt_append.trim()) {
            if (smode === "generate") {
              if (!prev.system_prompt_append.trim() || window.confirm("用 AI 生成的 system prompt 覆盖当前内容？")) {
                system_prompt_append = s.system_prompt_append
              }
            } else if (!system_prompt_append.trim()) {
              system_prompt_append = s.system_prompt_append
            }
          }
          return { ...prev, skill_ids, mcp_server_ids, system_prompt_append }
        })
        const src = s.source === "llm" ? "AI" : "关键词"
        const rationale = typeof s.rationale_zh === "string" ? s.rationale_zh : ""
        const label =
          smode === "generate" ? "生成" : smode === "optimize" ? "优化" : "推荐"
        setSuggestNote(
          `${src}${label}完成（可再改）${rationale ? `：${rationale}` : ""}`.slice(0, 220),
        )
        setBusy(null)
      }
      if (msg?.type === "pack.distill_preview") {
        // #370: 草稿只进编辑器（用户改后手动 pack.save_user）——绝不自动保存。
        const norm = normalizeDistillPreview(msg)
        setBusy(null)
        if (!norm) {
          flash("归纳失败：回包格式异常", 5000)
          return
        }
        if (msg.drained === true) {
          const remaining = typeof msg.remaining === "number" ? msg.remaining : 0
          flash(
            typeof msg.skip === "string"
              ? `队列一条被跳过（${msg.skip}），剩 ${remaining} 条`
              : `已续跑归纳 1 条，剩 ${remaining} 条`,
            4000,
          )
        }
        cloneToolsRef.current = null
        setDistillMeta(norm.meta)
        setSuggestNote("")
        setEditor({
          ...emptyEditor(),
          kind: "expert",
          name: norm.draft.name,
          description: norm.draft.description,
          system_prompt_append: norm.draft.system_prompt_append,
          // 保守 allowlist 姿态 + 不预勾：建议工具在 meta.suggested_tools 里展示
          tools_mode: "allowlist",
          tools_allow: [],
        })
      }
      if (msg?.type === "pack.distill_all_count") {
        // #411: 预点数回包（零 LLM）→ 打开一次性确认弹窗。
        setBusy(null)
        const eligible = typeof msg.eligible === "number" ? msg.eligible : 0
        if (eligible <= 0) {
          flash("没有可归纳的历史对话（跳过规则/排除条件过滤后为空）", 5000)
          return
        }
        const next = {
          eligible,
          with_digest: typeof msg.with_digest === "number" ? msg.with_digest : 0,
          capped: msg.capped === true,
        }
        setDistillAllConfirm((prev) =>
          prev ? { ...prev, ...next } : { ...next, since: "all", keyword: "" },
        )
      }
      if (msg?.type === "pack.distill_all_result") {
        // #411: K≤5 份草稿 → 内存队列，第 1 份进同一编辑器（逐份审阅）。
        setBusy(null)
        const norm = normalizeDistillAllDrafts(msg)
        if (!norm) {
          flash("全历史归纳失败：回包格式异常", 5000)
          return
        }
        if (norm.drafts.length === 0) {
          flash(
            `未归纳出草稿（${norm.fallback_reason || "历史里没有跨对话反复出现的角色"}）`,
            6000,
          )
          return
        }
        setDistillAllQueue({ drafts: norm.drafts, index: 0, scanned: norm.scanned })
        const first = norm.drafts[0]
        cloneToolsRef.current = null
        setSuggestNote("")
        setDistillMeta(distillAllMeta(first))
        setEditor({
          ...emptyEditor(),
          kind: "expert",
          name: first.name,
          description: first.description,
          system_prompt_append: first.system_prompt_append,
          tools_mode: "allowlist",
          tools_allow: [],
        })
        flash(
          `已归纳 ${norm.drafts.length} 份草稿（扫描 ${norm.scanned} 条 · ${norm.llm_calls} 次 LLM 调用），逐份审阅后手动保存`,
          7000,
        )
      }
      if (msg?.type === "pack.distill_armed" || msg?.type === "pack.distill_status") {
        const queue = Array.isArray(msg.queue) ? msg.queue : []
        const pending = Array.isArray(msg.pending) ? msg.pending : []
        setDistillStatus({
          armed: msg.armed === true,
          queue_len: queue.length,
          pending_len: pending.length,
        })
        if (typeof msg.restart_note === "string" && msg.restart_note) {
          setDistillRestartNote(msg.restart_note)
        }
        if (msg?.type === "pack.distill_armed") {
          setBusy(null)
          flash(
            msg.armed === true
              ? `空闲续跑队列已${queue.length > 0 ? `开启（待归纳 ${queue.length}）` : "开启"}`
              : "空闲续跑队列已关闭并清空",
            3500,
          )
        }
      }
      if (msg?.type === "skill.list" && Array.isArray(msg.skills)) {
        setSkillOptions(
          msg.skills.map((s: any) => ({
            name: s.name,
            description: s.description,
          })),
        )
      }
      if (msg?.type === "mcp.list" && Array.isArray(msg.servers)) {
        setMcpOptions(
          msg.servers.map((s: any) => ({
            name: s.name || s.id,
            status: s.connection?.status || s.status,
            enabled: s.enabled !== false,
          })),
        )
      }
      if (msg?.type === "pack.applied") {
        const appliedId =
          typeof msg.pack_id === "string"
            ? msg.pack_id
            : typeof msg.packId === "string"
              ? msg.packId
              : typeof msg.thread?.mission_pack_id === "string"
                ? msg.thread.mission_pack_id
                : pendingApplyRef.current?.packId || null
        flash(
          appliedId === "meeting-minutes"
            ? "已应用会议场景，正在打开会议工作台…"
            : "已用于本对话",
          2500,
        )
        setBusy(null)
        setConfirmPack(null)
        setTrustConflict(null)
        pendingApplyRef.current = null
        if (msg.thread?.id) dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        // Holder thread may have been unapplied on force_takeover — refresh list meta.
        chrome.runtime.sendMessage({ type: "thread.list" })
        // Hierarchy: 装配 › 场景 › 会议 — surface workbench after apply.
        if (appliedId === "meeting-minutes") {
          queueMicrotask(() => hostRef.current?.openPanelForce("meeting"))
        }
      }
      if (msg?.type === "pack.unapplied") {
        flash("已退出场景，回到通用助手", 2500)
        setBusy(null)
        if (msg.thread?.id) dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
      }
      if (msg?.type === "modules.list" || msg?.type === "modules.updated") {
        if (msg.modules) setModules(msg.modules)
        if (msg.type === "modules.updated") setBusy(null)
      }
      if (msg?.type === "workspace.pick_result") {
        if (msg.error && !msg.bound) {
          flash(msg.error)
        } else if (msg.path) {
          flash(msg.bound ? `工作区已绑定: ${msg.path}` : `已选择: ${msg.path}（绑定中…）`, 5000)
          if (msg.thread?.id) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          } else if (!msg.bound && activeThreadRef.current) {
            chrome.runtime.sendMessage({
              type: "workspace.set",
              thread_id: activeThreadRef.current,
              path: msg.path,
            })
          }
        }
      }
      if (msg?.type === "workspace.set_result" && msg.thread) {
        dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        flash(`工作区已绑定: ${msg.thread.workspace_root || ""}`, 4000)
      }
      if (msg?.type === "workspace.clear_result" && msg.thread) {
        dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        flash("已清除工作区绑定", 2500)
      }
      if (msg?.type === "error") {
        const holders = Array.isArray(msg.holders) ? (msg.holders as TrustHolderInfo[]) : []
        if (msg.code === "trust_holder_conflict" && holders.length > 0 && pendingApplyRef.current) {
          const pend = pendingApplyRef.current
          pendingApplyRef.current = null
          openTrustConflict(pend.packId, pend.packName, pend.threadId, holders, msg.error || "")
        } else {
          flash(msg.error || "操作失败", 5000)
          setBusy(null)
          pendingApplyRef.current = null
        }
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [dispatch])

  const enableModule = (mod: string) => {
    setBusy("modules")
    chrome.runtime.sendMessage({ type: "modules.set_enabled", module: mod, enabled: true })
    setTimeout(refresh, 400)
    flash(`已请求开启本机能力：${mod}`, 2500)
  }

  const pickWorkspace = () => {
    if (!state.activeThreadId) {
      flash("请先选择对话")
      return
    }
    chrome.runtime.sendMessage({
      type: "workspace.pick",
      thread_id: state.activeThreadId,
    })
  }

  const requestApply = (p: PackListItem) => {
    if (!state.activeThreadId) {
      flash("请先选择或创建对话")
      return
    }
    setTrustPhrase("")
    setConfirmPack(p)
  }

  const confirmApply = () => {
    if (!confirmPack || !state.activeThreadId) return
    if (packNeedsTrustPhrase(confirmPack)) {
      if (trustPhrase.trim() !== SECURITY_ARM_CONFIRM_PHRASE) {
        flash(`Trust 写入巡航旗需输入「${SECURITY_ARM_CONFIRM_PHRASE}」（≠ 无人值守武装）`)
        return
      }
    }
    setBusy(confirmPack.id)
    pendingApplyRef.current = {
      packId: confirmPack.id,
      packName: confirmPack.name,
      threadId: state.activeThreadId,
    }
    chrome.runtime.sendMessage({
      type: "pack.apply",
      pack_id: confirmPack.id,
      thread_id: state.activeThreadId,
      user_gesture: true,
      ...(packNeedsTrustPhrase(confirmPack)
        ? { confirmation_phrase: trustPhrase.trim() }
        : {}),
    })
    setConfirmPack(null)
    setTrustPhrase("")
  }

  /** After Trust conflict: release other holders' scenes and apply here. */
  const confirmTrustTakeover = () => {
    if (!trustConflict) return
    // Re-use apply confirm flow when phrase needed — force_takeover still requires phrase on server.
    const phrase =
      trustPhrase.trim() === SECURITY_ARM_CONFIRM_PHRASE
        ? trustPhrase.trim()
        : window.prompt(
            `Trust 写入全局巡航旗（≠ 无人值守）。请输入「${SECURITY_ARM_CONFIRM_PHRASE}」以确认：`,
            "",
          )
    if (phrase == null) return
    if (phrase.trim() !== SECURITY_ARM_CONFIRM_PHRASE) {
      flash(`需输入「${SECURITY_ARM_CONFIRM_PHRASE}」`)
      return
    }
    setBusy(trustConflict.packId)
    pendingApplyRef.current = {
      packId: trustConflict.packId,
      packName: trustConflict.packName,
      threadId: trustConflict.threadId,
    }
    chrome.runtime.sendMessage({
      type: "pack.apply",
      pack_id: trustConflict.packId,
      thread_id: trustConflict.threadId,
      user_gesture: true,
      force_takeover: true,
      confirmation_phrase: phrase.trim(),
    })
    setTrustConflict(null)
    setTrustPhrase("")
  }

  const unapply = () => {
    if (!state.activeThreadId) {
      flash("请先选择对话")
      return
    }
    setBusy("unapply")
    chrome.runtime.sendMessage({
      type: "pack.unapply",
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  const clearWorkspace = () => {
    if (!state.activeThreadId) {
      flash("请先选择对话")
      return
    }
    if (!workspaceRoot) {
      flash("当前未绑定工作区")
      return
    }
    setBusy("ws-clear")
    chrome.runtime.sendMessage({
      type: "workspace.clear",
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  const openSkills = () => {
    host?.openPanelForce("skills")
  }

  /** 装配 › 场景 › 会议 — open dedicated meeting workbench (not only /meeting). */
  const openMeetingWorkbench = () => {
    host?.openPanelForce("meeting")
  }

  const openSettings = () => {
    dispatch({ type: "SET_SETTINGS_OPEN", open: true })
  }

  const meetingPack = packs.find((p) => p.id === "meeting-minutes") || null

  const openCreateEditor = (kind: "mission" | "expert" = "mission") => {
    chrome.runtime.sendMessage({ type: "skill.list" })
    chrome.runtime.sendMessage({ type: "knowledge.list" })
    chrome.runtime.sendMessage({ type: "mcp.list" })
    setSuggestNote("")
    setDistillMeta(null)
    setEditor({ ...emptyEditor(), kind })
  }

  const openEditEditor = (p: PackListItem) => {
    if (!p.editable && p.origin !== "user") {
      flash("内置/已安装场景不可直接编辑；请用「另存为我的」")
      return
    }
    packGetModeRef.current = "edit"
    setBusy("edit")
    setDistillMeta(null)
    chrome.runtime.sendMessage({ type: "skill.list" })
    chrome.runtime.sendMessage({ type: "knowledge.list" })
    chrome.runtime.sendMessage({ type: "mcp.list" })
    chrome.runtime.sendMessage({ type: "pack.get", pack_id: p.id })
  }

  const openCloneEditor = (p: PackListItem) => {
    packGetModeRef.current = "clone"
    setBusy("clone")
    setDistillMeta(null)
    chrome.runtime.sendMessage({ type: "skill.list" })
    chrome.runtime.sendMessage({ type: "knowledge.list" })
    chrome.runtime.sendMessage({ type: "mcp.list" })
    chrome.runtime.sendMessage({ type: "pack.get", pack_id: p.id })
  }

  /** #369: builtin/停用包 — 只读查看（明文 prompt 完整可见）。 */
  const openViewEditor = (p: PackListItem) => {
    packGetModeRef.current = "view"
    setBusy("view")
    setDistillMeta(null)
    chrome.runtime.sendMessage({ type: "pack.get", pack_id: p.id })
  }

  /** #369: 停用/启用 — pack.get 原样回写并翻转 disabled（详见 toggle-disabled 分支）。 */
  const togglePackDisabled = (p: PackListItem) => {
    if (!isUserPack(p)) return
    if (p.disabled !== true && !window.confirm(`停用「${p.name}」？停用后不能再派出/套用，但可随时启用。`)) {
      return
    }
    packGetModeRef.current = "toggle-disabled"
    setBusy("toggle-disabled")
    chrome.runtime.sendMessage({ type: "pack.get", pack_id: p.id })
  }

  const toggleSkill = (name: string) => {
    setEditor((prev) => {
      if (!prev) return prev
      const has = prev.skill_ids.includes(name)
      return {
        ...prev,
        skill_ids: has ? prev.skill_ids.filter((s) => s !== name) : [...prev.skill_ids, name],
      }
    })
  }

  const toggleKnowledge = (name: string) => {
    setEditor((prev) => {
      if (!prev) return prev
      const has = prev.knowledge_ids.includes(name)
      return {
        ...prev,
        knowledge_ids: has
          ? prev.knowledge_ids.filter((s) => s !== name)
          : [...prev.knowledge_ids, name],
      }
    })
  }

  const toggleMcp = (name: string) => {
    setEditor((prev) => {
      if (!prev) return prev
      const has = prev.mcp_server_ids.includes(name)
      return {
        ...prev,
        mcp_server_ids: has
          ? prev.mcp_server_ids.filter((s) => s !== name)
          : [...prev.mcp_server_ids, name],
      }
    })
  }

  const requestAiSuggest = (mode: "recommend" | "generate" | "optimize" = "recommend") => {
    if (!editor) return
    if (mode === "optimize") {
      if (!editor.system_prompt_append.trim()) {
        flash("请先填写 system prompt，再请求优化")
        return
      }
    } else {
      const brief = editor.description.trim() || editor.name.trim()
      if (!brief && !editor.system_prompt_append.trim()) {
        flash("请先填写名称、简介或描述，再请求 AI")
        return
      }
    }
    setBusy("suggest")
    setSuggestNote(
      mode === "generate" ? "正在生成场景…" : mode === "optimize" ? "正在优化 prompt…" : "正在推荐…",
    )
    chrome.runtime.sendMessage({
      type: "pack.suggest_config",
      user_gesture: true,
      mode,
      name: editor.name.trim() || undefined,
      brief: editor.description.trim() || editor.name.trim(),
      system_prompt_append: editor.system_prompt_append.trim() || undefined,
    })
  }

  /** #370: 手点「从本对话归纳专家」— 发送前明示摘要去向（issue 验收）。 */
  const requestDistill = () => {
    const tid = activeThreadRef.current
    if (!tid) {
      flash("请先选择或创建对话")
      return
    }
    if (
      !window.confirm(
        `${DISTILL_ENTRY_LABEL}？\n\n${DISTILL_LLM_NOTICE}。\n` +
          "正文会先自动脱敏（密钥/令牌类内容打码）；草稿只保存在面板内存，不会自动保存为专家。",
      )
    ) {
      return
    }
    setBusy("distill")
    flash("正在归纳本对话…", 2500)
    chrome.runtime.sendMessage({
      type: "pack.distill_expert",
      thread_id: tid,
      user_gesture: true,
    })
  }

  /** #370: 把当前对话加入 armed 队列（默认 off；仅指针+语料 id 落盘）。 */
  const armDistill = () => {
    const tid = activeThreadRef.current
    if (!tid) {
      flash("请先选择或创建对话")
      return
    }
    if (
      !window.confirm(
        `加入空闲续跑队列？\n\n${DISTILL_LLM_NOTICE}。\n` +
          `${DISTILL_RESTART_LOSS_NOTE}。队列只保存任务指针与消息 id，不保存任何 LLM 产出。`,
      )
    ) {
      return
    }
    setBusy("distill-arm")
    chrome.runtime.sendMessage({
      type: "pack.distill_arm",
      thread_id: tid,
      user_gesture: true,
    })
  }

  const disarmDistill = () => {
    if (!window.confirm("关闭空闲续跑队列？将清空待归纳指针（不影响已保存的专家）。")) return
    setBusy("distill-disarm")
    chrome.runtime.sendMessage({ type: "pack.distill_disarm", user_gesture: true })
  }

  /** #370: 续跑 = 一次手点一条（无定时器/批量）。 */
  const drainDistill = () => {
    if (
      !window.confirm(
        `续跑归纳队列中的 1 条？\n\n${DISTILL_LLM_NOTICE}。\n归纳出的草稿只保存在面板内存，请审阅后手动保存。`,
      )
    ) {
      return
    }
    setBusy("distill-drain")
    chrome.runtime.sendMessage({ type: "pack.distill_drain", user_gesture: true })
  }

  // --- #411: 全历史归纳（方案 A 两级聚类；一次性手点，无定时器） ---

  /** 全历史草稿 → 编辑器横幅 meta（from_all_history 标记 + 多 thread 出处 + 冲突）。 */
  const distillAllMeta = (d: DistillAllDraftView): DistillMeta => ({
    source: "llm",
    notice: DISTILL_LLM_NOTICE,
    used_digest: false,
    suggested_tools: [...new Set(d.tools_allow)],
    evidence: d.evidence.map((e) => ({ quote: e.quote, ...(e.hint ? { hint: e.hint } : {}) })),
    suitable_for: d.suitable_for,
    unsuitable_for: d.unsuitable_for,
    from_all_history: true,
    ...(d.conflicts_with ? { conflicts_with: d.conflicts_with } : {}),
    ...(d.thread_ids.length > 0 ? { thread_ids: d.thread_ids } : {}),
  })

  /** 弹窗时间窗 → since ISO（"all" 或天数字符串）。 */
  const distillAllSinceIso = (since: string): string | undefined => {
    const days = Number(since)
    if (!Number.isFinite(days) || days <= 0) return undefined
    return new Date(Date.now() - days * 86400_000).toISOString()
  }

  const distillAllExclude = (since: string, keyword: string) => ({
    ...(distillAllSinceIso(since) ? { since: distillAllSinceIso(since) } : {}),
    ...(keyword.trim() ? { exclude_keyword: keyword.trim().slice(0, 80) } : {}),
  })

  /** 入口：先点数（零 LLM）→ 一次性确认弹窗。 */
  const requestDistillAll = () => {
    if (busy) return
    setBusy("distill-all")
    chrome.runtime.sendMessage({
      type: "pack.distill_all_scan",
      count_only: true,
      user_gesture: true,
    })
  }

  /** 弹窗里改排除项 → 重新点数（仍零 LLM；N 实时更新）。 */
  const recountDistillAll = (since: string, keyword: string) => {
    setDistillAllConfirm((prev) => (prev ? { ...prev, since, keyword } : prev))
    setBusy("distill-all")
    chrome.runtime.sendMessage({
      type: "pack.distill_all_scan",
      count_only: true,
      user_gesture: true,
      exclude: distillAllExclude(since, keyword),
    })
  }

  /** 确认后开始全量扫描（一次手点；LLM 调用 = 批次数 + 归并 1 次）。 */
  const startDistillAll = () => {
    const c = distillAllConfirm
    if (!c) return
    setDistillAllConfirm(null)
    setBusy("distill-all")
    flash("正在全历史归纳…（分批聚类 + 归并，可能需要一两分钟）", 4000)
    chrome.runtime.sendMessage({
      type: "pack.distill_all_scan",
      user_gesture: true,
      exclude: distillAllExclude(c.since, c.keyword),
    })
  }

  /** 队列导航：上一份/下一份直接装进同一编辑器（草稿仍未保存）。 */
  const gotoDistillAllDraft = (dir: -1 | 1) => {
    if (!distillAllQueue) return
    const index = distillAllQueueStep(
      distillAllQueue.index,
      distillAllQueue.drafts.length,
      dir,
    )
    if (index === distillAllQueue.index) return
    const d = distillAllQueue.drafts[index]
    if (!d) return
    setDistillAllQueue({ ...distillAllQueue, index })
    cloneToolsRef.current = null
    setSuggestNote("")
    setDistillMeta(distillAllMeta(d))
    setEditor({
      ...emptyEditor(),
      kind: "expert",
      name: d.name,
      description: d.description,
      system_prompt_append: d.system_prompt_append,
      tools_mode: "allowlist",
      tools_allow: [],
    })
  }

  const toggleToolAllow = (name: string) => {
    setEditor((prev) => {
      if (!prev) return prev
      const has = prev.tools_allow.includes(name)
      if (!has) {
        const high = SCENE_TOOL_GROUPS.find((g) => g.highRisk)?.tools.includes(name)
        if (
          high &&
          !window.confirm(
            `将「${name}」加入本场景工具面？\n仍需本机对应模块开启。\n` +
              `默认每次调用需安全确认；若同时勾选 Trust「跳过 L2 / 三旗巡航」，应用场景后可能免确认。`,
          )
        ) {
          return prev
        }
      }
      return {
        ...prev,
        tools_allow: has ? prev.tools_allow.filter((t) => t !== name) : [...prev.tools_allow, name],
        tools_mode: "allowlist",
      }
    })
  }

  const saveEditor = (andApply: boolean) => {
    if (!editor || editor.readOnly) return
    const noun = editor.kind === "expert" ? "专家" : "场景"
    if (!editor.name.trim()) {
      flash(`请填写${noun}名称`)
      return
    }
    if (!editor.system_prompt_append.trim()) {
      flash(`请填写该${noun}的 system prompt`)
      return
    }
    if (andApply && !state.activeThreadId) {
      flash("请先选择或创建对话，再保存并用于本对话")
      return
    }
    // Resolve tools: preserve_tools on clone uses source allowlist
    let toolsPayload:
      | { mode: "unchanged" | "allowlist"; allow: string[]; deny: string[] }
      | undefined
    if (editor.preserve_tools && cloneToolsRef.current?.mode === "allowlist") {
      toolsPayload = {
        mode: "allowlist",
        allow: [...cloneToolsRef.current.allow],
        deny: [],
      }
    } else if (editor.tools_mode === "allowlist") {
      const allow = [...editor.tools_allow]
      if (editor.skill_ids.length > 0 && !allow.includes("use_skill")) allow.push("use_skill")
      if (allow.length === 0) {
        flash("「仅允许勾选工具」时请至少勾选一个工具")
        return
      }
      toolsPayload = { mode: "allowlist", allow, deny: [] }
    } else {
      toolsPayload = { mode: "unchanged", allow: [], deny: [] }
    }
    const enableMods: string[] = []
    if (editor.trust_enable_modules || editor.trust_skip_l2) {
      if (toolsPayload?.allow?.includes("shell_exec") || editor.tools_allow.includes("shell_exec")) {
        enableMods.push("shell")
      }
      if (toolsPayload?.allow?.includes("netsec_port_scan") || editor.tools_allow.includes("netsec_port_scan")) {
        enableMods.push("netsec")
      }
      if (
        toolsPayload?.allow?.some((t) => t.startsWith("workspace_")) ||
        editor.tools_allow.some((t) => t.startsWith("workspace_"))
      ) {
        enableMods.push("devsec-workspace")
      }
      // If user asked enable modules without tools, still enable shell when skip_l2
      if (editor.trust_skip_l2 && enableMods.length === 0) {
        enableMods.push("shell", "netsec")
      }
    }
    const trustPayload =
      editor.trust_skip_l2 ||
      editor.trust_enable_modules ||
      editor.trust_auto_approve_dangerous ||
      editor.trust_auto_approve_enterprise ||
      editor.trust_allow_all_schemes
        ? {
            skip_l2: editor.trust_skip_l2,
            set_enterprise_profile:
              editor.trust_skip_l2 ||
              enableMods.includes("shell") ||
              enableMods.includes("netsec"),
            enable_modules: enableMods,
            auto_approve_dangerous: editor.trust_auto_approve_dangerous || editor.trust_skip_l2,
            auto_approve_enterprise_tools: editor.trust_auto_approve_enterprise || editor.trust_skip_l2,
            allow_all_schemes: editor.trust_allow_all_schemes || editor.trust_skip_l2,
          }
        : null

    const trustWritesCruise =
      !!trustPayload &&
      (trustPayload.skip_l2 ||
        trustPayload.auto_approve_dangerous ||
        trustPayload.auto_approve_enterprise_tools ||
        trustPayload.allow_all_schemes)

    if (trustPayload && andApply) {
      if (
        !window.confirm(
          "此场景将在「用于本对话」时写入全局安全配置（可能跳过 L2 / 开启模块 / auto_approve）。\n" +
            "Trust ≠ 无人值守武装；会持久写入 auto_approve_*，不能替代「我了解风险」值守短语流程。\n" +
            "退出场景会尽量恢复应用前的配置。确定继续？",
        )
      ) {
        return
      }
    }

    let phraseForApply: string | undefined
    if (andApply && trustWritesCruise) {
      const p =
        editorTrustPhrase.trim() ||
        window.prompt(
          `Trust 写入巡航旗需输入「${SECURITY_ARM_CONFIRM_PHRASE}」（≠ 无人值守武装）：`,
          "",
        )
      if (p == null) return
      if (p.trim() !== SECURITY_ARM_CONFIRM_PHRASE) {
        flash(`需输入「${SECURITY_ARM_CONFIRM_PHRASE}」`)
        return
      }
      phraseForApply = p.trim()
    }

    setBusy(andApply ? "save-apply" : "save")
    pendingApplyThreadRef.current = andApply ? state.activeThreadId || null : null
    if (andApply && state.activeThreadId) {
      pendingApplyRef.current = {
        packId: editor.id || "",
        packName: editor.name.trim(),
        threadId: state.activeThreadId,
      }
    } else {
      pendingApplyRef.current = null
    }
    chrome.runtime.sendMessage({
      type: "pack.save_user",
      user_gesture: true,
      id: editor.id || undefined,
      // #369: 专家保存写 kind=expert（复用 pack.save_user 既有路径）
      kind: editor.kind,
      name: editor.name.trim(),
      description: editor.description.trim() || undefined,
      system_prompt_append: editor.system_prompt_append.trim(),
      skill_ids: editor.skill_ids,
      knowledge_ids: editor.knowledge_ids,
      mcp_server_ids: editor.mcp_server_ids,
      tools: toolsPayload,
      trust: trustPayload,
      apply_thread_id: andApply ? state.activeThreadId || undefined : undefined,
      ...(phraseForApply ? { confirmation_phrase: phraseForApply } : {}),
    })
    setEditorTrustPhrase("")
  }

  const deleteUserScene = (p: PackListItem) => {
    if (!p.editable && p.origin !== "user") return
    if (!window.confirm(`删除用户场景「${p.name}」？正在使用该场景的对话会退出场景。`)) return
    setBusy("delete")
    chrome.runtime.sendMessage({
      type: "pack.delete_user",
      pack_id: p.id,
      user_gesture: true,
    })
  }

  const activePackId =
    (state.threads || []).find((t: any) => t.id === state.activeThreadId)?.mission_pack_id || null
  const activePack = packs.find((p) => p.id === activePackId) || null
  // #369: 场景段只列 kind≠expert；专家段只列 kind=expert
  const { scenes, experts } = segmentPacks(packs)

  const moduleLabel: Record<string, string> = {
    appsec: "应用安全场景",
    "devsec-workspace": "工作区读写",
    shell: "本机命令",
    netsec: "网络扫描",
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>装配 › {PANEL_TITLE}</div>
          <div style={styles.title}>{PANEL_TITLE}</div>
          <div style={styles.subtitle}>场景为本对话选用模板；专家是可派出的角色（builtin 只读，可另存定制）</div>
        </div>
        <button type="button" style={styles.linkBtn} onClick={refresh}>
          刷新
        </button>
      </div>

      {/* #369: 分段「场景 | 专家」（分段解决可发现性，不加第十面板） */}
      <div style={styles.segmentBar} role="tablist" aria-label="场景与专家分段">
        {(
          [
            ["scene", "场景"],
            ["expert", "专家"],
          ] as Array<[PackSegment, string]>
        ).map(([seg, label]) => (
          <button
            key={seg}
            type="button"
            role="tab"
            aria-selected={segment === seg}
            style={{
              ...styles.segmentBtn,
              ...(segment === seg ? styles.segmentBtnActive : null),
            }}
            onClick={() => setSegment(seg)}
          >
            {label}
          </button>
        ))}
      </div>

      <button type="button" style={styles.divert} onClick={openSkills}>
        要安装技能？→ 打开 Skills 导入
      </button>

      {status && <div style={styles.status}>{status}</div>}

      {segment === "scene" && (
        <>
      {/* Zone: 会议 — 装配 › 场景 › 会议（独立工作台，非仅 /meeting） */}
      <section style={styles.zone} data-testid="scene-meeting-zone">
        <div style={styles.zoneTitle}>会议</div>
        <div
          style={{
            ...styles.meetingCard,
            ...(activePackId === "meeting-minutes" ? styles.meetingCardActive : null),
          }}
        >
          <div style={styles.meetingTitle}>会议记录工作台</div>
          <div style={styles.desc}>
            粘贴转写或本机录制 → 可编辑转写 → 结构化纪要（TL;DR / 决议 / 待办）。应用场景不会自动开麦。
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" style={styles.primaryBtn} onClick={openMeetingWorkbench}>
              打开会议工作台
            </button>
            {meetingPack && activePackId !== "meeting-minutes" ? (
              <button
                type="button"
                style={styles.secondaryBtn}
                disabled={!!busy || !!meetingPack.apply_blocked}
                onClick={() => requestApply(meetingPack)}
                title="写入会议纪要 system prompt 与技能；录音仍须在工作台手动开始"
              >
                {busy === "meeting-minutes" ? "应用中…" : "应用「会议记录」场景"}
              </button>
            ) : activePackId === "meeting-minutes" ? (
              <span style={styles.modOn}>✓ 本对话已用会议场景</span>
            ) : null}
          </div>
        </div>
      </section>

      {/* Zone: 本对话状态 */}
      <section style={styles.zone}>
        <div style={styles.zoneTitle}>本对话状态</div>
        <div style={styles.stateCard}>
          <div>
            当前：
            <strong>{activePack ? `场景 · ${activePack.name}` : "通用助手"}</strong>
          </div>
          <div style={styles.stateMeta}>
            {workspaceRoot ? (
              <>
                工作区：<code style={{ fontSize: 10 }}>{workspaceRoot}</code>
              </>
            ) : (
              "工作区：默认沙箱 ~/CMspark-projects（可绑定真实项目）"
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {activePackId ? (
              <button type="button" style={styles.primaryBtn} onClick={unapply} disabled={!!busy}>
                {busy === "unapply" ? "退出中…" : "退出场景，回到通用助手"}
              </button>
            ) : null}
            <button type="button" style={styles.secondaryBtn} onClick={pickWorkspace} disabled={!!busy}>
              {workspaceRoot ? "更换工作区" : "选择工作区"}
            </button>
            {/* Clear only when explicit workspace_root is bound — not for default sandbox */}
            {workspaceRoot ? (
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={clearWorkspace}
                disabled={!!busy}
                title="仅解除绑定，不删除磁盘文件"
              >
                {busy === "ws-clear" ? "清除中…" : "清除工作区"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Zone: 场景模板 */}
      <section style={styles.zone}>
        <div style={{ ...styles.zoneTitle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>开始一个场景</span>
          <button type="button" style={styles.linkBtn} onClick={() => openCreateEditor("mission")} disabled={!!busy}>
            + 新建场景
          </button>
        </div>
        <div style={styles.hint}>
          用户场景可配置 system prompt、技能、知识库与 MCP；应用后优先使用勾选项（不额外收窄工具）。
        </div>
        {scenes.length === 0 && <div style={styles.empty}>暂无已安装场景模板</div>}
        <ul style={styles.list}>
          {scenes.map((p) => {
            const blocked = p.apply_blocked
            const isActive = activePackId === p.id
            const copy = sceneCopy(p)
            const isUser = p.editable || p.origin === "user"
            return (
              <li
                key={p.id}
                style={{
                  ...styles.item,
                  ...(isActive ? styles.itemActive : null),
                }}
              >
                <div style={styles.row}>
                  <strong style={styles.name}>
                    {p.name}
                    {isUser ? " · 我的" : ""}
                    {p.has_trust ? " · ⚠️ Trust" : ""}
                    {isActive ? " · 本对话使用中" : ""}
                  </strong>
                  <span style={styles.meta}>
                    {p.channel} · v{p.version}
                  </span>
                </div>
                {p.description && <div style={styles.desc}>{p.description}</div>}
                {p.has_trust ? (
                  <div style={{ ...styles.toolsLine, color: tokens.warning }}>
                    应用时将写入全局安全配置
                    {p.trust_skip_l2 ? "（含跳过 L2 / 三旗巡航）" : ""}
                    ；退出/切换/删除场景会尽量恢复
                  </div>
                ) : null}
                {isUser && (p.skill_refs?.length || p.mcp_servers?.length) ? (
                  <div style={styles.toolsLine}>
                    技能 {p.skill_refs?.length || 0} · MCP {p.mcp_servers?.length || 0}
                  </div>
                ) : null}
                {copy && (
                  <div style={styles.copyBlock}>
                    <div>
                      <span style={styles.copyLabel}>适合</span> {copy.suitable}
                    </div>
                    <div>
                      <span style={styles.copyLabelBad}>不适合</span> {copy.unsuitable}
                    </div>
                    <div style={styles.toolsLine}>将允许：{copy.tools}</div>
                  </div>
                )}
                {blocked && <div style={styles.blocked}>{blocked}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {isActive ? (
                    <button type="button" style={styles.primaryBtn} onClick={unapply} disabled={!!busy}>
                      退出场景
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={styles.primaryBtn}
                      disabled={!!busy || !!blocked}
                      title={
                        isUser
                          ? "应用用户场景：写入 system prompt，并优先使用勾选的技能与 MCP"
                          : "与开启本机能力不同 — 专业场景可能限制本对话可用工具"
                      }
                      onClick={() => requestApply(p)}
                    >
                      {busy === p.id ? "应用中…" : "用于本对话"}
                    </button>
                  )}
                  {p.id === "meeting-minutes" ? (
                    <button
                      type="button"
                      style={styles.secondaryBtn}
                      onClick={openMeetingWorkbench}
                      title="装配 › 场景 › 会议工作台"
                    >
                      打开会议工作台
                    </button>
                  ) : null}
                  {isUser ? (
                    <>
                      <button type="button" style={styles.secondaryBtn} onClick={() => openEditEditor(p)} disabled={!!busy}>
                        编辑
                      </button>
                      <button type="button" style={styles.secondaryBtn} onClick={() => deleteUserScene(p)} disabled={!!busy}>
                        删除
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      style={styles.secondaryBtn}
                      onClick={() => openCloneEditor(p)}
                      disabled={!!busy}
                      title="复制为可编辑的用户场景（默认不收窄工具）"
                    >
                      另存为我的
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Zone: 本机能力 modules */}
      <section style={styles.zone}>
        <div style={styles.zoneTitle}>本机能力</div>
        <div style={styles.hint}>电源开关：允许本机使用某类能力，不等于「用于本对话」。</div>
        {(["appsec", "devsec-workspace", "shell", "netsec"] as const).map((mod) =>
          modules[mod] && modules[mod].enabled !== true ? (
            <div key={mod} style={styles.banner}>
              未开启：{moduleLabel[mod] || mod}
              <button type="button" style={styles.primaryBtn} onClick={() => enableModule(mod)}>
                开启
              </button>
            </div>
          ) : modules[mod]?.enabled === true ? (
            <div key={mod} style={styles.modOn}>
              ✓ {moduleLabel[mod] || mod}
            </div>
          ) : null,
        )}
        <button type="button" style={{ ...styles.divert, marginTop: 8, marginBottom: 0 }} onClick={openSettings}>
          网络扫描目标 / 本对话授权 → 设置
        </button>
      </section>
        </>
      )}

      {/* #369 Zone: 专家 — kind=expert 的 pack；builtin 只读，用户专家 CRUD */}
      {segment === "expert" && (
      <section style={styles.zone} data-testid="expert-zone">
        <div style={{ ...styles.zoneTitle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>专家（可派出的角色）</span>
          <button type="button" style={styles.linkBtn} onClick={() => openCreateEditor("expert")} disabled={!!busy}>
            + 新建专家
          </button>
        </div>
        <div style={styles.hint}>{EXPERT_SEGMENT_HINT}</div>
        {/* #370 I4: 从本对话归纳专家草稿 — 手点 user_gesture；草稿不自动保存 */}
        <div style={styles.distillCard} data-testid="distill-card">
          <div style={styles.distillTitle}>{DISTILL_ENTRY_LABEL}</div>
          <div style={styles.hint}>
            从当前对话归纳一份专家草稿（名称 / 提示词 / 保守工具建议 / 对话证据）。
            正文先自动脱敏；{DISTILL_LLM_NOTICE}。草稿只在面板里等你看，不会自动保存。
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={requestDistill}
              disabled={!!busy}
              data-testid="distill-entry-btn"
            >
              {busy === "distill" ? "归纳中…" : `✨ ${DISTILL_ENTRY_LABEL}`}
            </button>
            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={armDistill}
              disabled={!!busy || !state.activeThreadId}
              title="加入空闲续跑队列（默认关闭；仅存任务指针与消息 id）"
            >
              {busy === "distill-arm" ? "加入中…" : "排队空闲续跑"}
            </button>
            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={requestDistillAll}
              disabled={!!busy}
              title="扫描全部历史对话（一次性手点；浅层画像分批聚类，深读 ≤20 条）"
              data-testid="distill-all-entry-btn"
            >
              {busy === "distill-all" ? "归纳中…" : `📚 ${DISTILL_ALL_ENTRY_LABEL}`}
            </button>
          </div>
          {/* #411: 全历史草稿队列 — 极薄上一份/下一份，逐份审阅；保存仍手动 */}
          {distillAllQueue && distillAllQueue.drafts.length > 0 ? (
            <div style={styles.toolsLine} data-testid="distill-all-queue">
              <div>
                {distillAllQueueLine({
                  index: distillAllQueue.index,
                  total: distillAllQueue.drafts.length,
                  conflicts_with: distillAllQueue.drafts[distillAllQueue.index]?.conflicts_with,
                })}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                <button
                  type="button"
                  style={styles.linkBtn}
                  onClick={() => gotoDistillAllDraft(-1)}
                  disabled={distillAllQueue.index <= 0}
                >
                  ← 上一份
                </button>
                <button
                  type="button"
                  style={styles.linkBtn}
                  onClick={() => gotoDistillAllDraft(1)}
                  disabled={distillAllQueue.index >= distillAllQueue.drafts.length - 1}
                >
                  下一份 →
                </button>
                <button
                  type="button"
                  style={styles.linkBtn}
                  onClick={() => setDistillAllQueue(null)}
                  title="关闭队列（已保存的专家不受影响；未审草稿本就重启即丢）"
                >
                  关闭队列
                </button>
              </div>
            </div>
          ) : null}
          {/* armed 队列状态行：默认 off 可见；续跑=一次手点一条 */}
          <div style={styles.toolsLine} data-testid="distill-status-line">
            {distillStatus ? distillStatusLine(distillStatus) : "空闲续跑队列：读取中…"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={drainDistill}
              disabled={!!busy || !distillStatus?.armed || distillStatus.queue_len <= 0}
              title="归纳队列中的 1 条（不会批量）"
            >
              {busy === "distill-drain" ? "续跑中…" : DISTILL_DRAIN_LABEL}
            </button>
            {distillStatus?.armed ? (
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={disarmDistill}
                disabled={!!busy}
              >
                {DISTILL_DISARM_LABEL}
              </button>
            ) : null}
          </div>
          <div style={{ ...styles.hint, marginBottom: 0, marginTop: 4 }}>{distillRestartNote}</div>
        </div>
        {experts.length === 0 && (
          <div style={styles.empty} data-testid="expert-empty">
            {EXPERT_EMPTY_COPY}
          </div>
        )}
        <ul style={styles.list}>
          {experts.map((p) => {
            const isActive = activePackId === p.id
            const copy = sceneCopy(p)
            const user = isUserPack(p)
            const actions = expertCardActions(p)
            const info = expertInfo[p.id]
            const usageLine = info ? formatUsageLine(info.spawn_count, info.last_spawn_at) : null
            return (
              <li
                key={p.id}
                style={{
                  ...styles.item,
                  ...(isActive ? styles.itemActive : null),
                  ...(p.disabled ? styles.itemDisabled : null),
                }}
              >
                <div style={styles.row}>
                  <strong style={styles.name}>
                    {p.name}
                    {user ? " · 我的" : ""}
                    {!user ? " · 内置" : ""}
                    {p.disabled ? " · 已停用" : ""}
                    {isActive ? " · 本对话使用中" : ""}
                  </strong>
                  <span style={styles.meta}>
                    {p.channel} · v{p.version}
                  </span>
                </div>
                {p.description && <div style={styles.desc}>{p.description}</div>}
                {copy && (
                  <div style={styles.copyBlock}>
                    <div>
                      <span style={styles.copyLabel}>适合</span> {copy.suitable}
                    </div>
                    <div>
                      <span style={styles.copyLabelBad}>不适合</span> {copy.unsuitable}
                    </div>
                  </div>
                )}
                <div style={styles.toolsLine} data-testid={`expert-effective-${p.id}`}>
                  {info
                    ? formatEffectiveToolsLine(info.effective_tools)
                    : "有效工具面：计算中…"}
                </div>
                {usageLine ? (
                  <div
                    style={styles.toolsLine}
                    title="按 spawn 的 role_label 与专家 id/name 匹配统计（启发式，非权威口径）"
                  >
                    {usageLine}
                  </div>
                ) : null}
                {p.disabled ? (
                  <div style={styles.blocked}>已停用：不可派出/套用；编辑器只读可打开，启用后恢复</div>
                ) : null}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {actions.includes("team") && (
                    <button
                      type="button"
                      style={styles.primaryBtn}
                      disabled
                      title={EXPERT_PRIMARY_CTA_DISABLED_HINT}
                    >
                      {EXPERT_PRIMARY_CTA_LABEL}·即将推出
                    </button>
                  )}
                  {actions.includes("apply") &&
                    (isActive ? (
                      <button type="button" style={styles.primaryBtn} onClick={unapply} disabled={!!busy}>
                        退出场景
                      </button>
                    ) : (
                      <button
                        type="button"
                        style={styles.secondaryBtn}
                        disabled={!!busy || !!p.apply_blocked}
                        title="将专家角色与工具面套用到当前对话（不是派出 worker）"
                        onClick={() => requestApply(p)}
                      >
                        {busy === p.id ? "应用中…" : EXPERT_SECONDARY_CTA_LABEL}
                      </button>
                    ))}
                  {actions.includes("view") && (
                    <button type="button" style={styles.secondaryBtn} onClick={() => openViewEditor(p)} disabled={!!busy}>
                      查看
                    </button>
                  )}
                  {actions.includes("edit") && (
                    <button type="button" style={styles.secondaryBtn} onClick={() => openEditEditor(p)} disabled={!!busy}>
                      编辑
                    </button>
                  )}
                  {actions.includes("clone") && (
                    <button
                      type="button"
                      style={styles.secondaryBtn}
                      onClick={() => openCloneEditor(p)}
                      disabled={!!busy}
                      title="复制为可编辑的我的专家（默认不收窄工具）"
                    >
                      另存为我的
                    </button>
                  )}
                  {actions.includes("disable") && (
                    <button type="button" style={styles.secondaryBtn} onClick={() => togglePackDisabled(p)} disabled={!!busy}>
                      {busy === "toggle-disabled" ? "处理中…" : "停用"}
                    </button>
                  )}
                  {actions.includes("enable") && (
                    <button type="button" style={styles.primaryBtn} onClick={() => togglePackDisabled(p)} disabled={!!busy}>
                      {busy === "toggle-disabled" ? "处理中…" : "启用"}
                    </button>
                  )}
                  {actions.includes("delete") && (
                    <button type="button" style={styles.secondaryBtn} onClick={() => deleteUserScene(p)} disabled={!!busy}>
                      删除
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
      )}

      {/* #411: 全历史归纳一次性确认（N 条摘要发 LLM 必须写明 + 排除项） */}
      {distillAllConfirm && (
        <div
          style={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={DISTILL_ALL_ENTRY_LABEL}
        >
          <div style={styles.modal}>
            <div style={styles.modalTitle}>{DISTILL_ALL_ENTRY_LABEL}？</div>
            <p style={styles.modalP}>{distillAllConfirmBody(distillAllConfirm)}</p>
            <div style={{ ...styles.modalP, display: "grid", gap: 8, margin: "8px 0" }}>
              <label style={{ fontSize: 12 }}>
                只看最近：
                <select
                  value={distillAllConfirm.since}
                  onChange={(e) => recountDistillAll(e.target.value, distillAllConfirm.keyword)}
                  disabled={busy === "distill-all"}
                  style={{ marginLeft: 6 }}
                >
                  <option value="all">全部历史</option>
                  <option value="7">近 7 天</option>
                  <option value="30">近 30 天</option>
                  <option value="90">近 90 天</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                排除关键词（命中标题/首末问的对话不参与）：
                <input
                  style={styles.input}
                  value={distillAllConfirm.keyword}
                  onChange={(e) =>
                    setDistillAllConfirm({ ...distillAllConfirm, keyword: e.target.value })
                  }
                  onBlur={() =>
                    recountDistillAll(distillAllConfirm.since, distillAllConfirm.keyword)
                  }
                  placeholder="如：会议、测试"
                  disabled={busy === "distill-all"}
                />
              </label>
            </div>
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={() => setDistillAllConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                style={styles.primaryBtn}
                onClick={startDistillAll}
                disabled={busy === "distill-all" || distillAllConfirm.eligible <= 0}
                data-testid="distill-all-start-btn"
              >
                {busy === "distill-all" ? "统计中…" : "开始归纳"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trust single-holder conflict: one-click unlock + apply */}
      {trustConflict && (
        <div
          style={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Trust 已被其他对话占用"
        >
          <div style={styles.modal}>
            <div style={styles.modalTitle}>Trust 已被其他对话占用</div>
            <p style={styles.modalP}>
              全局 Trust 同时只能由一个对话持有。下列对话仍挂着 Trust 场景（对话结束不会自动释放）：
            </p>
            <ul style={{ ...styles.modalP, margin: "8px 0", paddingLeft: 18 }}>
              {trustConflict.holders.map((h) => (
                <li key={h.id}>
                  <strong>{h.alias || h.id}</strong>
                  {h.pack_id ? (
                    <span style={{ color: tokens.textMuted, fontSize: 11 }}> · {h.pack_id}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p style={styles.modalP}>
              选择「解锁并用于本对话」将<strong>退出占用方场景</strong>（尽量恢复其应用前配置），再将「
              {trustConflict.packName}」应用到当前对话。
            </p>
            <p style={{ ...styles.modalP, color: tokens.warning, fontWeight: 600 }}>
              ⚠️ 这会移动全局安全配置的占用权；请确认占用方对话可以退出场景。
            </p>
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={() => setTrustConflict(null)}
                disabled={!!busy}
              >
                取消
              </button>
              <button
                type="button"
                style={styles.primaryBtn}
                onClick={confirmTrustTakeover}
                disabled={!!busy}
              >
                {busy === trustConflict.packId ? "处理中…" : "解锁并用于本对话"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply confirm modal */}
      {confirmPack && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="确认用于本对话">
          <div style={styles.modal}>
            <div style={styles.modalTitle}>将「{confirmPack.name}」用于本对话？</div>
            {sceneCopy(confirmPack) ? (
              <>
                <p style={styles.modalP}>
                  <strong>适合：</strong>
                  {sceneCopy(confirmPack)!.suitable}
                </p>
                <p style={styles.modalP}>
                  <strong>不适合：</strong>
                  {sceneCopy(confirmPack)!.unsuitable}
                </p>
                <p style={styles.modalP}>
                  <strong>将会：</strong>
                  切换助手角色；工具变为「{sceneCopy(confirmPack)!.tools}」。可随时退出场景。
                </p>
              </>
            ) : (
              <p style={styles.modalP}>
                {confirmPack.description || "将应用该场景模板到当前对话（可能限制可用工具）。"}
              </p>
            )}
            {confirmPack.has_trust ? (
              <p style={{ ...styles.modalP, color: tokens.warning, fontWeight: 600 }}>
                ⚠️ Trust：此场景应用后会<strong>持久写入</strong>全局安全配置
                {confirmPack.trust_skip_l2
                  ? "（skip_l2 / 三旗 auto_approve_dangerous + enterprise + allow_all_schemes）"
                  : "（可能开启模块或 auto_approve）"}
                。
                <br />
                <strong>Trust ≠ 无人值守武装</strong>：不会开启桌面值守 grant；不能替代设置里「我了解风险」值守流程。
                退出场景会尽量恢复巡航旗。
              </p>
            ) : null}
            {packNeedsTrustPhrase(confirmPack) ? (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12, color: tokens.warning, fontWeight: 600, display: "block" }}>
                  请输入「{SECURITY_ARM_CONFIRM_PHRASE}」以确认写入巡航旗：
                </label>
                <input
                  type="text"
                  value={trustPhrase}
                  onChange={(e) => setTrustPhrase(e.target.value)}
                  placeholder={SECURITY_ARM_CONFIRM_PHRASE}
                  style={{
                    width: "100%",
                    marginTop: 6,
                    padding: "6px 8px",
                    fontSize: 13,
                    borderRadius: tokens.radiusSm,
                    border: `1px solid ${tokens.warning}`,
                    boxSizing: "border-box",
                  }}
                  autoComplete="off"
                />
              </div>
            ) : null}
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={() => {
                  setConfirmPack(null)
                  setTrustPhrase("")
                }}
              >
                取消
              </button>
              <button type="button" style={styles.primaryBtn} onClick={confirmApply} disabled={!!busy}>
                用于本对话
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / edit / view user scene or expert */}
      {editor && (
        <div
          style={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={editor.readOnly ? "查看（只读）" : editor.id ? "编辑" : "新建"}
        >
          <div style={{ ...styles.modal, maxWidth: 360, maxHeight: "90vh", overflow: "auto" }}>
            <div style={styles.modalTitle}>
              {editor.readOnly
                ? `查看${editor.kind === "expert" ? "专家" : "场景"}（只读）`
                : editor.id
                  ? `编辑${editor.kind === "expert" ? "专家" : "场景"}`
                  : `新建${editor.kind === "expert" ? "专家" : "场景"}`}
            </div>
            {editor.readOnly ? (
              <div style={{ ...styles.hint, color: tokens.warning }}>
                只读：{editor.kind === "expert" ? "内置/已停用专家" : "内置/已停用场景"}
                不可直接修改；可「另存为我的」定制，或先在卡片上「启用」。
              </div>
            ) : null}
            {distillMeta ? (
              <div style={styles.distillBanner} data-testid="distill-banner">
                <div style={{ fontWeight: 650, fontSize: 11, marginBottom: 4 }}>
                  {distillSourceLabel(distillMeta)}
                </div>
                {distillMeta.source === "llm" ? null : (
                  <div style={styles.hint}>LLM 不可用或输出不可解析时给空草稿——本面板仍可手动创建专家。</div>
                )}
                {/* #411: 与已装专家重叠 — 覆盖/另存由用户裁决，不是静默去重 */}
                {distillMeta.conflicts_with ? (
                  <div style={{ ...styles.hint, color: tokens.warning, fontWeight: 600 }}>
                    与已装专家「{distillMeta.conflicts_with}」名字或工具面重叠——保存前请改名另存，或确认要覆盖心智。
                  </div>
                ) : null}
                {distillMeta.thread_ids && distillMeta.thread_ids.length > 0 ? (
                  <div style={styles.distillEvidenceLine}>
                    <span style={styles.copyLabel}>出处</span>
                    {distillMeta.thread_ids.length} 条对话（{distillMeta.thread_ids.slice(0, 5).join("、")}
                    {distillMeta.thread_ids.length > 5 ? " 等" : ""}）——证据来自多条历史对话
                  </div>
                ) : null}
                {distillMeta.suitable_for.length > 0 ? (
                  <div style={styles.distillEvidenceLine}>
                    <span style={styles.copyLabel}>适合</span>
                    {distillMeta.suitable_for.join("；")}
                  </div>
                ) : null}
                {distillMeta.unsuitable_for.length > 0 ? (
                  <div style={styles.distillEvidenceLine}>
                    <span style={styles.copyLabelBad}>不适合</span>
                    {distillMeta.unsuitable_for.join("；")}
                  </div>
                ) : null}
                {distillMeta.evidence.length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    <div style={styles.distillEvidenceHead}>对话证据（来自本对话，可点开原对话核对）：</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {distillMeta.evidence.map((e, i) => (
                        <li key={i} style={styles.distillEvidenceLine}>
                          「{e.quote}」{e.hint ? <span style={{ color: tokens.textMuted }}> — {e.hint}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div style={{ ...styles.hint, marginBottom: 0, marginTop: 4 }}>
                  {distillMeta.notice}；{DISTILL_SUGGESTED_TOOLS_LABEL.split("（")[0]}见工具策略区（未预勾）。
                </div>
              </div>
            ) : null}
            <fieldset disabled={editor.readOnly} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
            <label style={styles.fieldLabel}>场景描述（可先写一句话，再 AI 生成）</label>
            <input
              style={styles.input}
              value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              placeholder="例如：授权渗透、确认 root，用 redteam 技能与 shell"
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <button
                type="button"
                style={styles.linkBtn}
                onClick={() => requestAiSuggest("generate")}
                disabled={!!busy}
                title="根据描述生成 prompt 并推荐技能/MCP"
              >
                {busy === "suggest" ? "生成中…" : "✨ AI 生成场景"}
              </button>
              <button
                type="button"
                style={styles.linkBtn}
                onClick={() => requestAiSuggest("recommend")}
                disabled={!!busy}
              >
                推荐技能/MCP
              </button>
              <button
                type="button"
                style={styles.linkBtn}
                onClick={() => requestAiSuggest("optimize")}
                disabled={!!busy}
                title="在已有 prompt 与勾选基础上优化文案"
              >
                优化 Prompt
              </button>
            </div>
            <label style={styles.fieldLabel}>名称</label>
            <input
              style={styles.input}
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="例如：投研助手"
            />
            <label style={styles.fieldLabel}>System prompt</label>
            <textarea
              style={styles.textarea}
              value={editor.system_prompt_append}
              onChange={(e) => setEditor({ ...editor, system_prompt_append: e.target.value })}
              placeholder="该场景下助手的角色与输出要求…"
              rows={5}
            />
            {!editor.id && cloneToolsRef.current?.mode === "allowlist" ? (
              <label style={{ ...styles.checkRow, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={editor.preserve_tools}
                  onChange={(e) => {
                    const on = e.target.checked
                    setEditor({
                      ...editor,
                      preserve_tools: on,
                      tools_mode: on ? "allowlist" : "unchanged",
                      tools_allow: on
                        ? [...(cloneToolsRef.current?.allow || [])]
                        : editor.tools_allow,
                    })
                  }}
                />
                <span>
                  <strong>保留原场景的工具限制</strong>
                  <span style={{ display: "block", fontSize: 10, color: tokens.textMuted }}>
                    不勾选则默认不额外限制工具（全工具面，仍受模块与 L2 约束）
                  </span>
                </span>
              </label>
            ) : null}
            <label style={styles.fieldLabel}>可用技能（应用时优先启用）</label>
            <div style={styles.checkList}>
              {skillOptions.length === 0 && <div style={styles.empty}>暂无技能，可先到 Skills 安装</div>}
              {skillOptions.map((s) => (
                <label key={s.name} style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={editor.skill_ids.includes(s.name)}
                    onChange={() => toggleSkill(s.name)}
                  />
                  <span>
                    <strong>{s.name}</strong>
                    {s.description ? (
                      <span style={{ color: tokens.textMuted, display: "block", fontSize: 10 }}>
                        {s.description.slice(0, 80)}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
            <label style={styles.fieldLabel}>知识库（应用时写入本对话；manual 模式）</label>
            <div style={styles.checkList}>
              {(state.knowledgeDocs || []).length === 0 && (
                <div style={styles.empty}>暂无知识文档，可到「知识」面板导入</div>
              )}
              {(state.knowledgeDocs || []).map((d: { name: string; title?: string; description?: string }) => (
                <label key={d.name} style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={editor.knowledge_ids.includes(d.name)}
                    onChange={() => toggleKnowledge(d.name)}
                  />
                  <span>
                    <strong>{d.title || d.name}</strong>
                    {d.description ? (
                      <span style={{ color: tokens.textMuted, display: "block", fontSize: 10 }}>
                        {d.description.slice(0, 80)}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
            <label style={styles.fieldLabel}>可用 MCP（应用时仅暴露这些；与工具白名单正交）</label>
            <div style={styles.checkList}>
              {mcpOptions.length === 0 && <div style={styles.empty}>暂无已配置 MCP，可到设置添加</div>}
              {mcpOptions.map((s) => (
                <label key={s.name} style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={editor.mcp_server_ids.includes(s.name)}
                    onChange={() => toggleMcp(s.name)}
                  />
                  <span>
                    <strong>{s.name}</strong>
                    <span style={{ color: tokens.textMuted, fontSize: 10, marginLeft: 6 }}>
                      {s.status || (s.enabled === false ? "disabled" : "")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <label style={styles.fieldLabel}>工具策略</label>
            <label style={styles.checkRow}>
              <input
                type="radio"
                name="tools_mode"
                checked={editor.tools_mode === "unchanged" && !editor.preserve_tools}
                onChange={() =>
                  setEditor({ ...editor, tools_mode: "unchanged", preserve_tools: false })
                }
              />
              <span>不额外限制（默认；模型仍可见本机已暴露的工具）</span>
            </label>
            <label style={styles.checkRow}>
              <input
                type="radio"
                name="tools_mode"
                checked={editor.tools_mode === "allowlist" || editor.preserve_tools}
                onChange={() => setEditor({ ...editor, tools_mode: "allowlist" })}
              />
              <span>仅允许勾选的工具（可收窄专业面）</span>
            </label>
            {(editor.tools_mode === "allowlist" || editor.preserve_tools) && (
              <div style={styles.checkList}>
                {distillMeta && distillMeta.suggested_tools.length > 0 ? (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: tokens.accent, marginBottom: 2 }}>
                      {DISTILL_SUGGESTED_TOOLS_LABEL}
                    </div>
                    {distillMeta.suggested_tools.map((tn) => (
                      <label key={tn} style={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={editor.tools_allow.includes(tn)}
                          onChange={() => toggleToolAllow(tn)}
                          disabled={editor.preserve_tools}
                        />
                        <span style={{ fontFamily: tokens.fontMono, fontSize: 11 }}>{tn}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {SCENE_TOOL_GROUPS.map((g) => (
                  <div key={g.title} style={{ marginBottom: 6 }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: g.highRisk ? tokens.warning : tokens.textMuted,
                        marginBottom: 2,
                      }}
                    >
                      {g.title}
                    </div>
                    {g.tools.map((tn) => (
                      <label key={tn} style={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={editor.tools_allow.includes(tn)}
                          onChange={() => toggleToolAllow(tn)}
                          disabled={editor.preserve_tools}
                        />
                        <span style={{ fontFamily: tokens.fontMono, fontSize: 11 }}>{tn}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <label style={{ ...styles.fieldLabel, color: tokens.warning }}>Trust（应用场景时写全局配置 · 选项 B）</label>
            <div style={{ ...styles.hint, marginBottom: 4 }}>
              仅「我的」场景。应用时<strong>持久写入</strong> Companion 配置（auto_approve_*）；
              退出场景会尝试恢复。
              <strong> Trust skip_l2 / 三旗 ≠ 无人值守武装</strong>——不能替代设置里的值守短语与双勾选。
            </div>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={editor.trust_skip_l2}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    trust_skip_l2: e.target.checked,
                    // skip_l2 implies full cruise flags
                    trust_auto_approve_dangerous: e.target.checked || editor.trust_auto_approve_dangerous,
                    trust_auto_approve_enterprise: e.target.checked || editor.trust_auto_approve_enterprise,
                    trust_allow_all_schemes: e.target.checked || editor.trust_allow_all_schemes,
                    trust_enable_modules: e.target.checked || editor.trust_enable_modules,
                  })
                }
              />
              <span>
                <strong>跳过 L2</strong>
                <span style={{ display: "block", fontSize: 10, color: tokens.textMuted }}>
                  写入三旗巡航（≠ 桌面值守）。应用时需输入「{SECURITY_ARM_CONFIRM_PHRASE}」
                </span>
              </span>
            </label>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={editor.trust_enable_modules}
                onChange={(e) => setEditor({ ...editor, trust_enable_modules: e.target.checked })}
              />
              <span>
                <strong>自动开启模块</strong>
                <span style={{ display: "block", fontSize: 10, color: tokens.textMuted }}>
                  按工具面推导 shell / netsec / workspace，并切 enterprise profile
                </span>
              </span>
            </label>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={editor.trust_auto_approve_dangerous}
                onChange={(e) =>
                  setEditor({ ...editor, trust_auto_approve_dangerous: e.target.checked })
                }
              />
              <span>写 auto_approve_dangerous</span>
            </label>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={editor.trust_auto_approve_enterprise}
                onChange={(e) =>
                  setEditor({ ...editor, trust_auto_approve_enterprise: e.target.checked })
                }
              />
              <span>写 auto_approve_enterprise_tools</span>
            </label>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={editor.trust_allow_all_schemes}
                onChange={(e) => setEditor({ ...editor, trust_allow_all_schemes: e.target.checked })}
              />
              <span>写 allow_all_schemes（协议解锁 / god-mode）</span>
            </label>
            {suggestNote ? <div style={{ ...styles.hint, marginTop: 8, color: tokens.accent }}>{suggestNote}</div> : null}
            {(editor.trust_skip_l2 ||
              editor.trust_auto_approve_dangerous ||
              editor.trust_auto_approve_enterprise ||
              editor.trust_allow_all_schemes) && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12, color: tokens.warning, fontWeight: 600, display: "block" }}>
                  「保存并用于本对话」时输入「{SECURITY_ARM_CONFIRM_PHRASE}」：
                </label>
                <input
                  type="text"
                  value={editorTrustPhrase}
                  onChange={(e) => setEditorTrustPhrase(e.target.value)}
                  placeholder={SECURITY_ARM_CONFIRM_PHRASE}
                  style={{
                    width: "100%",
                    marginTop: 6,
                    padding: "6px 8px",
                    fontSize: 13,
                    borderRadius: tokens.radiusSm,
                    border: `1px solid ${tokens.warning}`,
                    boxSizing: "border-box",
                  }}
                  autoComplete="off"
                />
              </div>
            )}
            <div style={{ ...styles.hint, marginTop: 8 }}>
              AI 只预填，不会自动保存。勾选 Trust 巡航旗后「保存并用于本对话」会改全局安全配置并要求短语确认。
            </div>
            </fieldset>
            <div style={{ ...styles.modalActions, flexWrap: "wrap" }}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={() => {
                  setEditor(null)
                  setSuggestNote("")
                  setDistillMeta(null)
                  cloneToolsRef.current = null
                  pendingApplyThreadRef.current = null
                }}
                disabled={busy === "save" || busy === "save-apply"}
              >
                {editor.readOnly ? "关闭" : "取消"}
              </button>
              {!editor.readOnly && (
                <>
                  <button type="button" style={styles.secondaryBtn} onClick={() => saveEditor(false)} disabled={!!busy}>
                    {busy === "save" ? "保存中…" : "保存"}
                  </button>
                  <button type="button" style={styles.primaryBtn} onClick={() => saveEditor(true)} disabled={!!busy}>
                    {busy === "save-apply" ? "保存并应用…" : "保存并用于本对话"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, import("react").CSSProperties> = {
  wrap: { padding: "8px 10px", fontSize: 12, color: tokens.text, position: "relative" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  breadcrumb: {
    fontSize: 10,
    color: tokens.textMuted,
    letterSpacing: "0.02em",
    marginBottom: 2,
  },
  title: { fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" },
  subtitle: { fontSize: 10, color: tokens.textMuted, marginTop: 2, lineHeight: 1.35 },
  meetingCard: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding: 10,
    background: tokens.bg,
  },
  meetingCardActive: {
    background: tokens.accentSoft || tokens.bgActive,
  },
  itemActive: {
    background: tokens.accentSoft || tokens.bgActive,
    border: `1px solid ${tokens.borderStrong}`,
  },
  meetingTitle: { fontWeight: 650, fontSize: 12, marginBottom: 4 },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 11,
  },
  divert: {
    width: "100%",
    textAlign: "left",
    border: `1px solid ${tokens.border}`,
    background: tokens.accentSoft,
    color: tokens.accentText,
    borderRadius: tokens.radiusMd,
    padding: "6px 8px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 8,
    fontFamily: tokens.font,
  },
  status: { fontSize: 11, color: tokens.accent, marginBottom: 6 },
  segmentBar: {
    display: "flex",
    gap: 4,
    marginBottom: 10,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding: 2,
    background: tokens.bg,
  },
  segmentBtn: {
    flex: 1,
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 0",
    border: "none",
    borderRadius: tokens.radiusSm,
    background: "transparent",
    color: tokens.textMuted,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  segmentBtnActive: {
    background: tokens.bgActive,
    color: tokens.accent,
  },
  itemDisabled: {
    opacity: 0.72,
  },
  zone: { marginBottom: 12 },
  zoneTitle: {
    fontSize: 10,
    fontWeight: 650,
    color: tokens.textMuted,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  stateCard: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding: 8,
    background: tokens.bg,
    fontSize: 11,
  },
  stateMeta: { fontSize: 10, color: tokens.textMuted, marginTop: 4 },
  banner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    background: tokens.warningSoft,
    borderRadius: 6,
    marginBottom: 6,
    fontSize: 11,
  },
  modOn: { fontSize: 11, color: tokens.textSecondary, marginBottom: 4 },
  hint: { fontSize: 10, color: tokens.textMuted, marginBottom: 6, lineHeight: 1.35 },
  empty: { color: tokens.textSecondary, fontSize: 11, padding: "4px 0" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 },
  item: {
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    padding: 8,
    background: tokens.bgElevated,
  },
  row: { display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 },
  name: { fontSize: 12 },
  meta: { fontSize: 10, color: tokens.textMuted },
  desc: { fontSize: 11, color: tokens.textSecondary, marginBottom: 6 },
  copyBlock: { fontSize: 10, color: tokens.textSecondary, marginBottom: 6, lineHeight: 1.4 },
  copyLabel: { color: tokens.success, fontWeight: 700, marginRight: 4 },
  copyLabelBad: { color: tokens.warning, fontWeight: 700, marginRight: 4 },
  toolsLine: { marginTop: 4, color: tokens.textMuted },
  blocked: { fontSize: 10, color: tokens.warning, marginBottom: 6 },
  primaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgActive,
    color: tokens.accent,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  secondaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgElevated,
    color: tokens.text,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: tokens.scrim || "rgba(15,23,42,0.28)",
    zIndex: 400,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modal: {
    background: tokens.bgElevated,
    borderRadius: tokens.radiusLg,
    boxShadow: tokens.shadowLg,
    padding: 14,
    maxWidth: 320,
    width: "100%",
    fontFamily: tokens.font,
  },
  modalTitle: { fontWeight: 650, fontSize: 13, marginBottom: 8 },
  modalP: { fontSize: 11, color: tokens.textSecondary, lineHeight: 1.45, margin: "0 0 8px" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  fieldLabel: {
    display: "block",
    fontSize: 10,
    fontWeight: 650,
    color: tokens.textMuted,
    margin: "8px 0 4px",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    fontFamily: tokens.font,
    background: tokens.bg,
    color: tokens.text,
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    fontFamily: tokens.font,
    background: tokens.bg,
    color: tokens.text,
    resize: "vertical" as const,
    minHeight: 88,
  },
  checkList: {
    maxHeight: 140,
    overflow: "auto",
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    padding: 6,
    background: tokens.bg,
  },
  distillCard: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding: 8,
    background: tokens.bg,
    marginBottom: 8,
  },
  distillTitle: { fontWeight: 650, fontSize: 12, marginBottom: 4 },
  distillBanner: {
    border: `1px solid ${tokens.accent}`,
    borderRadius: 6,
    padding: 8,
    background: tokens.accentSoft || tokens.bgActive,
    marginBottom: 8,
    fontSize: 10,
    lineHeight: 1.4,
  },
  distillEvidenceHead: { fontSize: 10, fontWeight: 650, color: tokens.textMuted },
  distillEvidenceLine: { fontSize: 10, color: tokens.textSecondary, lineHeight: 1.45 },
  checkRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 11,
    marginBottom: 6,
    cursor: "pointer",
  },
}
