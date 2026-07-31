// 场景 panel (Mission Packs) — product rename from「任务包」.
// SoT: docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md
// Zones: 本对话状态 · 场景模板（含用户可配 system prompt/skills/MCP）· 本机能力

import { useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { useContextPanelHostOptional } from "./ContextPanelHost"

export type PackListItem = {
  id: string
  name: string
  description?: string
  version: string
  channel: string
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
}

type ModuleStateView = {
  available?: boolean
  enabled?: boolean
  target_allowlist?: string[]
  require_task_auth?: boolean
}

type SkillOption = { name: string; description?: string }
type McpOption = { name: string; status?: string; enabled?: boolean }

type SceneEditorState = {
  /** null = create; string = edit existing user pack id */
  id: string | null
  name: string
  description: string
  system_prompt_append: string
  skill_ids: string[]
  mcp_server_ids: string[]
}

const emptyEditor = (): SceneEditorState => ({
  id: null,
  name: "",
  description: "",
  system_prompt_append: "",
  skill_ids: [],
  mcp_server_ids: [],
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
  const [packs, setPacks] = useState<PackListItem[]>([])
  const [modules, setModules] = useState<Record<string, ModuleStateView>>({})
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmPack, setConfirmPack] = useState<PackListItem | null>(null)
  const [editor, setEditor] = useState<SceneEditorState | null>(null)
  const [skillOptions, setSkillOptions] = useState<SkillOption[]>([])
  const [mcpOptions, setMcpOptions] = useState<McpOption[]>([])
  /** After pack.saved_user, apply to this thread (also sent as apply_thread_id). */
  const pendingApplyThreadRef = useRef<string | null>(null)
  /** pack.get mode: edit existing user pack vs clone builtin into new user scene. */
  const packGetModeRef = useRef<"edit" | "clone">("edit")
  const [suggestNote, setSuggestNote] = useState<string>("")
  const activeThreadRef = useRef(state.activeThreadId)
  activeThreadRef.current = state.activeThreadId

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
  }

  useEffect(() => {
    refresh()
    const handler = (msg: any) => {
      if (msg?.type === "pack.list" && Array.isArray(msg.packs)) {
        setPacks(msg.packs)
      }
      if (msg?.type === "pack.installed" || msg?.type === "pack.uninstalled" || msg?.type === "pack.saved_user" || msg?.type === "pack.deleted_user") {
        if (Array.isArray(msg.packs)) setPacks(msg.packs)
        else refresh()
        if (msg?.type === "pack.saved_user") {
          setBusy(null)
          setEditor(null)
          setSuggestNote("")
          if (msg.applied && msg.thread?.id) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
            flash(msg.id ? `已保存并用于本对话：${msg.id}` : "已保存并用于本对话", 3000)
            pendingApplyThreadRef.current = null
          } else if (msg.apply_error) {
            flash(`场景已保存，但应用失败：${msg.apply_error}`, 5000)
            pendingApplyThreadRef.current = null
          } else if (pendingApplyThreadRef.current && msg.id) {
            // Fallback if server ignored apply_thread_id
            const tid = pendingApplyThreadRef.current
            pendingApplyThreadRef.current = null
            chrome.runtime.sendMessage({
              type: "pack.apply",
              pack_id: msg.id,
              thread_id: tid,
              user_gesture: true,
            })
            flash(msg.id ? `场景已保存，正在用于本对话…` : "场景已保存", 2500)
          } else {
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
        if (mode === "clone") {
          // 另存为我的：new user scene, no id; tools stay unchanged (not AppSec allowlist)
          const refs = Array.isArray(p.skill_refs) ? p.skill_refs : []
          const installed = Array.isArray(p.installed_skill_ids) ? p.installed_skill_ids : []
          setEditor({
            id: null,
            name: `${p.name || "场景"}（我的）`,
            description: p.description || "",
            system_prompt_append: p.system_prompt_append || "",
            skill_ids: [...new Set([...refs, ...installed])],
            mcp_server_ids: Array.isArray(p.mcp_servers) ? p.mcp_servers : [],
          })
          setSuggestNote("已从模板复制。用户场景默认不收窄工具；可改 prompt / 技能后保存。")
        } else {
          setEditor({
            id: p.id,
            name: p.name || "",
            description: p.description || "",
            system_prompt_append: p.system_prompt_append || "",
            skill_ids: Array.isArray(p.skill_refs) ? p.skill_refs : [],
            mcp_server_ids: Array.isArray(p.mcp_servers) ? p.mcp_servers : [],
          })
          setSuggestNote("")
        }
        setBusy(null)
      }
      if (msg?.type === "pack.suggest_config" && msg.suggestion) {
        const s = msg.suggestion
        setEditor((prev) => {
          if (!prev) return prev
          const nextSkills = Array.isArray(s.skill_ids) ? s.skill_ids : []
          const nextMcp = Array.isArray(s.mcp_server_ids) ? s.mcp_server_ids : []
          // Merge: AI picks become selected (union with existing if user already ticked some)
          const skill_ids = [...new Set([...prev.skill_ids, ...nextSkills])]
          const mcp_server_ids = [...new Set([...prev.mcp_server_ids, ...nextMcp])]
          let system_prompt_append = prev.system_prompt_append
          if (
            (!system_prompt_append || !system_prompt_append.trim()) &&
            typeof s.system_prompt_append === "string" &&
            s.system_prompt_append.trim()
          ) {
            system_prompt_append = s.system_prompt_append
          }
          return { ...prev, skill_ids, mcp_server_ids, system_prompt_append }
        })
        const src = s.source === "llm" ? "AI" : "关键词"
        const rationale = typeof s.rationale_zh === "string" ? s.rationale_zh : ""
        setSuggestNote(
          `${src} 推荐已勾选（可再改）${rationale ? `：${rationale}` : ""}`.slice(0, 200),
        )
        setBusy(null)
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
        flash("已用于本对话", 2500)
        setBusy(null)
        setConfirmPack(null)
        if (msg.thread?.id) dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
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
        flash(msg.error || "操作失败", 5000)
        setBusy(null)
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
    setConfirmPack(p)
  }

  const confirmApply = () => {
    if (!confirmPack || !state.activeThreadId) return
    setBusy(confirmPack.id)
    chrome.runtime.sendMessage({
      type: "pack.apply",
      pack_id: confirmPack.id,
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
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

  const openSettings = () => {
    dispatch({ type: "SET_SETTINGS_OPEN", open: true })
  }

  const openCreateEditor = () => {
    chrome.runtime.sendMessage({ type: "skill.list" })
    chrome.runtime.sendMessage({ type: "mcp.list" })
    setSuggestNote("")
    setEditor(emptyEditor())
  }

  const openEditEditor = (p: PackListItem) => {
    if (!p.editable && p.origin !== "user") {
      flash("内置/已安装场景不可直接编辑；请用「另存为我的」")
      return
    }
    packGetModeRef.current = "edit"
    setBusy("edit")
    chrome.runtime.sendMessage({ type: "skill.list" })
    chrome.runtime.sendMessage({ type: "mcp.list" })
    chrome.runtime.sendMessage({ type: "pack.get", pack_id: p.id })
  }

  const openCloneEditor = (p: PackListItem) => {
    packGetModeRef.current = "clone"
    setBusy("clone")
    chrome.runtime.sendMessage({ type: "skill.list" })
    chrome.runtime.sendMessage({ type: "mcp.list" })
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

  const requestAiSuggest = () => {
    if (!editor) return
    const brief = editor.description.trim() || editor.name.trim()
    if (!brief && !editor.system_prompt_append.trim()) {
      flash("请先填写名称、简介或 system prompt，再请求 AI 推荐")
      return
    }
    setBusy("suggest")
    setSuggestNote("正在推荐…")
    chrome.runtime.sendMessage({
      type: "pack.suggest_config",
      user_gesture: true,
      name: editor.name.trim() || undefined,
      brief: editor.description.trim() || editor.name.trim(),
      system_prompt_append: editor.system_prompt_append.trim() || undefined,
    })
  }

  const saveEditor = (andApply: boolean) => {
    if (!editor) return
    if (!editor.name.trim()) {
      flash("请填写场景名称")
      return
    }
    if (!editor.system_prompt_append.trim()) {
      flash("请填写该场景的 system prompt")
      return
    }
    if (andApply && !state.activeThreadId) {
      flash("请先选择或创建对话，再保存并用于本对话")
      return
    }
    setBusy(andApply ? "save-apply" : "save")
    pendingApplyThreadRef.current = andApply ? state.activeThreadId || null : null
    chrome.runtime.sendMessage({
      type: "pack.save_user",
      user_gesture: true,
      id: editor.id || undefined,
      name: editor.name.trim(),
      description: editor.description.trim() || undefined,
      system_prompt_append: editor.system_prompt_append.trim(),
      skill_ids: editor.skill_ids,
      mcp_server_ids: editor.mcp_server_ids,
      apply_thread_id: andApply ? state.activeThreadId || undefined : undefined,
    })
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
          <div style={styles.title}>场景</div>
          <div style={styles.subtitle}>为本对话选用模板（可限制可用工具）</div>
        </div>
        <button type="button" style={styles.linkBtn} onClick={refresh}>
          刷新
        </button>
      </div>

      <button type="button" style={styles.divert} onClick={openSkills}>
        要安装技能？→ 打开 Skills 导入
      </button>

      {status && <div style={styles.status}>{status}</div>}

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
              "工作区：未选择"
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
          <button type="button" style={styles.linkBtn} onClick={openCreateEditor} disabled={!!busy}>
            + 新建场景
          </button>
        </div>
        <div style={styles.hint}>
          用户场景可配置 system prompt、技能与 MCP；应用后优先使用勾选项（不额外收窄工具）。
        </div>
        {packs.length === 0 && <div style={styles.empty}>暂无已安装场景模板</div>}
        <ul style={styles.list}>
          {packs.map((p) => {
            const blocked = p.apply_blocked
            const isActive = activePackId === p.id
            const copy = sceneCopy(p)
            const isUser = p.editable || p.origin === "user"
            return (
              <li key={p.id} style={styles.item}>
                <div style={styles.row}>
                  <strong style={styles.name}>
                    {p.name}
                    {isUser ? " · 我的" : ""}
                    {isActive ? " · 本对话使用中" : ""}
                  </strong>
                  <span style={styles.meta}>
                    {p.channel} · v{p.version}
                  </span>
                </div>
                {p.description && <div style={styles.desc}>{p.description}</div>}
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
            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryBtn} onClick={() => setConfirmPack(null)}>
                取消
              </button>
              <button type="button" style={styles.primaryBtn} onClick={confirmApply} disabled={!!busy}>
                用于本对话
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / edit user scene */}
      {editor && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="编辑场景">
          <div style={{ ...styles.modal, maxWidth: 360, maxHeight: "90vh", overflow: "auto" }}>
            <div style={styles.modalTitle}>{editor.id ? "编辑场景" : "新建场景"}</div>
            <label style={styles.fieldLabel}>名称</label>
            <input
              style={styles.input}
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="例如：投研助手"
            />
            <label style={styles.fieldLabel}>简介（可选）</label>
            <input
              style={styles.input}
              value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              placeholder="一句话说明这个场景做什么"
            />
            <label style={styles.fieldLabel}>System prompt</label>
            <textarea
              style={styles.textarea}
              value={editor.system_prompt_append}
              onChange={(e) => setEditor({ ...editor, system_prompt_append: e.target.value })}
              placeholder="该场景下助手的角色与输出要求…"
              rows={5}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <label style={{ ...styles.fieldLabel, margin: 0 }}>可用技能（应用时优先启用）</label>
              <button
                type="button"
                style={styles.linkBtn}
                onClick={requestAiSuggest}
                disabled={!!busy}
                title="根据名称/简介/prompt 推荐技能与 MCP（需确认后保存）"
              >
                {busy === "suggest" ? "推荐中…" : "✨ AI 推荐"}
              </button>
            </div>
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
            <label style={styles.fieldLabel}>可用 MCP（应用时仅暴露这些）</label>
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
            {suggestNote ? <div style={{ ...styles.hint, marginTop: 8, color: tokens.accent }}>{suggestNote}</div> : null}
            <div style={{ ...styles.hint, marginTop: 8 }}>
              AI 只预勾选，不会自动保存；请检查后点「保存」或「保存并用于本对话」。
            </div>
            <div style={{ ...styles.modalActions, flexWrap: "wrap" }}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={() => {
                  setEditor(null)
                  setSuggestNote("")
                  pendingApplyThreadRef.current = null
                }}
                disabled={busy === "save" || busy === "save-apply"}
              >
                取消
              </button>
              <button type="button" style={styles.secondaryBtn} onClick={() => saveEditor(false)} disabled={!!busy}>
                {busy === "save" ? "保存中…" : "保存"}
              </button>
              <button type="button" style={styles.primaryBtn} onClick={() => saveEditor(true)} disabled={!!busy}>
                {busy === "save-apply" ? "保存并应用…" : "保存并用于本对话"}
              </button>
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
  title: { fontWeight: 650, fontSize: 14, letterSpacing: "-0.02em" },
  subtitle: { fontSize: 10, color: tokens.textMuted, marginTop: 2, lineHeight: 1.35 },
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
    background: "#fff7ed",
    borderRadius: 6,
    marginBottom: 6,
    fontSize: 11,
  },
  modOn: { fontSize: 11, color: tokens.textSecondary, marginBottom: 4 },
  hint: { fontSize: 10, color: tokens.textMuted, marginBottom: 6, lineHeight: 1.35 },
  empty: { color: tokens.textMuted, fontSize: 11, padding: "4px 0" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 },
  item: {
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    borderRadius: 8,
    padding: 8,
    background: tokens.bgElevated || "#fff",
  },
  row: { display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 },
  name: { fontSize: 12 },
  meta: { fontSize: 10, color: tokens.textMuted },
  desc: { fontSize: 11, color: tokens.textSecondary, marginBottom: 6 },
  copyBlock: { fontSize: 10, color: tokens.textSecondary, marginBottom: 6, lineHeight: 1.4 },
  copyLabel: { color: tokens.success, fontWeight: 700, marginRight: 4 },
  copyLabelBad: { color: tokens.warning, fontWeight: 700, marginRight: 4 },
  toolsLine: { marginTop: 4, color: tokens.textMuted },
  blocked: { fontSize: 10, color: "#b45309", marginBottom: 6 },
  primaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
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
  checkRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 11,
    marginBottom: 6,
    cursor: "pointer",
  },
}
