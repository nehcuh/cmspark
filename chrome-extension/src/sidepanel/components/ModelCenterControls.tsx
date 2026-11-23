import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react"
import { useAgentStore } from "../store/agentStore"
import { requestModelCenter, type ModelCenterAction, type ModelCenterState } from "../utils/model-center"
import { tokens } from "../ui/tokens"

type ProfileForm = { name: string; base_url: string; model_name: string; api_key: string; protocol: "openai" | "anthropic" }
const emptyForm: ProfileForm = { name: "", base_url: "", model_name: "", api_key: "", protocol: "openai" }

export function ModelCenterControls({ active, mode = "profiles", onFooterSave }: { active: boolean; mode?: "profiles" | "meeting"; onFooterSave?: (control: { dirty: boolean; busy: boolean; save: (known?: ModelCenterState) => Promise<boolean | ModelCenterState>; error?: string } | null) => void }) {
  const { state } = useAgentStore()
  const connected = state.connectionState === "connected"
  const [snapshot, setSnapshot] = useState<ModelCenterState | null>(null)
  const snapshotRef = useRef<ModelCenterState | null>(null)
  snapshotRef.current = snapshot
  const [error, setError] = useState("")
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<ProfileForm>(emptyForm)
  const [pending, setPending] = useState<ModelCenterAction | null>(null)
  const pendingRef = useRef<ModelCenterAction | null>(null)
  pendingRef.current = pending
  const [selected, setSelected] = useState("")
  const request = useRef<AbortController | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const formDirty = Object.keys(emptyForm).some(key => form[key as keyof ProfileForm] !== emptyForm[key as keyof ProfileForm])
  const run = useCallback(async (save?: { action: ModelCenterAction; config_revision: string }, known?: ModelCenterState) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(""); setStatus("")
    try {
      let next: ModelCenterState
      if (save) {
        const expected = known ?? snapshotRef.current
        const latest = await requestModelCenter(controller.signal)
        if (!expected || JSON.stringify(expected.model_center) !== JSON.stringify(latest.model_center)) {
          snapshotRef.current = latest
          setSnapshot(latest)
          throw new Error("模型配置已在别处更改，请核对后重试。")
        }
        next = await requestModelCenter(controller.signal, { action: save.action, config_revision: latest.config_revision })
      } else next = await requestModelCenter(controller.signal)
      if (controller.signal.aborted) return
      snapshotRef.current = next
      setSnapshot(next)
      if (save || !pendingRef.current) setSelected((mode === "meeting" ? next.model_center.meeting_minutes_profile_id : next.model_center.chat_profile_id) ?? "")
      if (save) {
        setPending(previous => previous === save.action ? null : previous)
        if (save.action.kind === "create") setForm(emptyForm)
        setStatus("已保存并核对配置。")
        if (save.action.kind === "bind" && save.action.scope === "chat") void chrome.runtime.sendMessage({ type: "config.get" }).catch(() => {})
      }
      return next
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "未确认配置结果。")
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false) }
    }
  }, [mode])
  useEffect(() => {
    if (active && connected && !request.current) void run()
    else if (!state.settingsOpen || !connected) { setForm(old => ({ ...old, api_key: "" })); setPending(null) }
  }, [active, connected, run, state.settingsOpen])
  useEffect(() => () => { request.current?.abort(); request.current = null }, [])

  const view = snapshot?.model_center
  const boundId = mode === "meeting" ? view?.meeting_minutes_profile_id : view?.chat_profile_id
  const bound = view?.profiles.find(p => p.id === boundId)
  const target = view?.profiles.find(p => p.id === selected)
  const customCurrent = state.companionConfig?.model_name || "未配置"
  const selectedScope = mode === "meeting" ? "meeting_minutes" : "chat"
  const submit = (action: ModelCenterAction, known?: ModelCenterState): Promise<ModelCenterState | false> => {
    if (!connected || busy || !snapshotRef.current) return Promise.resolve(false)
    return run({ action, config_revision: snapshotRef.current.config_revision }, known).then(next => next || false)
  }
  const createAction = (): ModelCenterAction | null => {
    const { name, protocol, base_url, model_name, api_key } = form
    if (name.trim() && base_url.trim() && model_name.trim()) {
      return { kind: "create", name: name.trim(), provider: { protocol, base_url: base_url.trim(), model_name: model_name.trim(), ...(api_key.trim() ? { api_key: api_key.trim() } : {}) } }
    }
    return null
  }
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const action = createAction()
    if (action) void submit(action)
  }

  const pendingSave = pending?.kind === "bind" || ((pending?.kind === "rename" || pending?.kind === "save_current") && !!pending.name.trim())
  useEffect(() => {
    if (!onFooterSave) return
    const dirty = pendingSave || (mode === "profiles" && formDirty)
    onFooterSave(dirty ? { dirty: true, busy: busy || !connected || !snapshot, error,
      save: async (known?: ModelCenterState) => {
        let latest: ModelCenterState | undefined = known
        if (pendingSave && pending) {
          const result = await submit(pending, latest)
          if (!result) return false
          latest = result
        }
        if (mode === "profiles" && formDirty) {
          const action = createAction()
          if (!action || !formRef.current?.checkValidity()) { setError("请返回文本模型配置，填写完整且有效的模型信息。") ; return false }
          const result = await submit(action, latest)
          if (!result) return false
          latest = result
        }
        return latest ?? true
      } } : null)
    return () => onFooterSave(null)
  }, [active, mode, form, formDirty, pending, pendingSave, busy, connected, snapshot, error, onFooterSave])

  return <div style={styles.root} data-model-center={mode}>
    <p style={styles.note}>{mode === "meeting" ? "纪要模型接收你确认的逐字稿、模板和参考笔记。更换模型只影响之后生成的纪要。" : "连接模型服务后，可在不同场景复用。一项配置包含服务地址、协议和模型名称。"}</p>
    {!connected && <p role="status">连接 Companion 后可查看和管理模型。</p>}
    {connected && <>
      <button type="button" onClick={() => void run()} disabled={busy}>刷新配置</button>
      {busy && <span role="status"> 正在核对配置…</span>}
    </>}
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {view && <fieldset style={styles.group} disabled={busy || !connected}>
      <legend>{mode === "meeting" ? "会议纪要用什么模型" : "默认对话模型"}</legend>
      <p style={styles.note}>当前 {bound ? bound.name + " · " + bound.model_name : (mode === "meeting" ? "继承默认对话 · " : "当前配置 · ") + customCurrent}</p>
      {bound && <p style={styles.note}>{bound.base_url}</p>}
      <label style={styles.field}>选择模型
        <select value={selected} onChange={event => {
          const next = event.target.value
          setSelected(next)
          setPending(next === (boundId ?? "") ? null : { kind: "bind", scope: selectedScope, profile_id: next || null })
        }} style={styles.input}>
          <option value="">{mode === "meeting" ? "继承默认对话模型" : "保留当前配置（取消关联）"}</option>
          {view.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model_name}</option>)}
        </select>
      </label>
      <button type="button" disabled={selected === (boundId ?? "")} onClick={() => setPending({ kind: "bind", scope: selectedScope, profile_id: selected || null })}>预览切换</button>
      {pending?.kind === "bind" && <div style={styles.preview}>
        <p style={styles.note}>{target ? target.name + " · " + target.model_name + " · " + target.base_url : mode === "meeting" ? "继承默认对话模型" : "取消关联，保留当前对话模型"}</p>
        <p style={styles.note}>{mode === "meeting" ? "用于这之后的纪要生成。" : "用于默认对话，以及复用默认模型的看图、听写纠错、活动提取、后台摘要和设置助手。"}{mode === "profiles" && !view.meeting_minutes_profile_id ? "会议纪要也会继承此项。" : ""}</p>
        <button type="button" onClick={() => submit(pending)}>确认切换</button>{" "}
        <button type="button" onClick={() => { setPending(null); setSelected(boundId ?? "") }}>取消</button>
      </div>}
    </fieldset>}
    {mode === "profiles" && view && <>
      <form ref={formRef} onSubmit={create}>
        <fieldset style={styles.group} disabled={busy || !connected}>
          <legend>添加文本模型</legend>
          <label style={styles.field}>配置名称<input style={styles.input} maxLength={80} required value={form.name} onChange={e => setForm(old => ({ ...old, name: e.target.value }))} /></label>
          <label style={styles.field}>模型名称<input style={styles.input} maxLength={160} required value={form.model_name} onChange={e => setForm(old => ({ ...old, model_name: e.target.value }))} /></label>
          <label style={styles.field}>服务地址<input style={styles.input} type="url" placeholder="https://…" required value={form.base_url} onChange={e => setForm(old => ({ ...old, base_url: e.target.value }))} /></label>
          <label style={styles.field}>API Key<input style={styles.input} type="password" autoComplete="off" required value={form.api_key} onChange={e => setForm(old => ({ ...old, api_key: e.target.value }))} /></label>
          <label style={styles.field}>协议<select style={styles.input} value={form.protocol} onChange={e => setForm(old => ({ ...old, protocol: e.target.value === "anthropic" ? "anthropic" : "openai" }))}><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic Messages</option></select></label>
          <button type="submit">保存模型</button>
          <p style={styles.note}>保存配置后，可以在需要的用途选用。连通性可在默认对话模型设置里测试。</p>
        </fieldset>
      </form>
      <fieldset style={styles.group} disabled={busy || !connected}>
        <legend>保存当前模型配置</legend>
        <p style={styles.note}>保留现有服务的高级兼容选项，供其他用途选择。</p>
        <button type="button" disabled={customCurrent === "未配置"} onClick={() => setPending({ kind: "save_current", name: "" })}>保存当前配置为新模型</button>
        {pending?.kind === "save_current" && <label style={styles.field}>配置名称
          <input value={pending.name} maxLength={80} style={styles.input} onChange={e => setPending({ kind: "save_current", name: e.target.value })} />
          <button type="button" disabled={!pending.name.trim()} onClick={() => submit(pending)}>确认保存</button>
        </label>}
      </fieldset>
      <ul style={styles.list}>{view.profiles.map(profile => <li key={profile.id} style={styles.group}>
        <strong>{profile.name}</strong>
        <p style={styles.note}>{profile.model_name} · {profile.base_url}</p>
        <p style={styles.note}>{profile.has_key ? "已配置密钥" : "未配置密钥"}{view.chat_profile_id === profile.id ? " · 当前用于对话" : ""}{view.meeting_minutes_profile_id === profile.id ? " · 当前用于会议纪要" : ""}</p>
        <button type="button" disabled={busy || !connected} onClick={() => setPending({ kind: "rename", profile_id: profile.id, name: profile.name })}>重命名</button>{" "}
        <button type="button" disabled={busy || !connected || view.chat_profile_id === profile.id || view.meeting_minutes_profile_id === profile.id} onClick={() => setPending({ kind: "remove", profile_id: profile.id })}>移除</button>
        {pending?.kind === "rename" && pending.profile_id === profile.id && <label style={styles.field}>新名称
          <input style={styles.input} maxLength={80} value={pending.name} onChange={e => setPending({ ...pending, name: e.target.value })} />
          <button type="button" disabled={busy || !pending.name.trim()} onClick={() => submit(pending)}>确认重命名</button>
        </label>}
        {pending?.kind === "remove" && pending.profile_id === profile.id && <div style={styles.preview}>
          <p style={styles.note}>移除 {profile.name} 的连接配置。</p>
          <button type="button" disabled={busy} onClick={() => submit(pending)}>确认移除</button>{" "}
          <button type="button" onClick={() => setPending(null)}>取消</button>
        </div>}
      </li>)}</ul>
    </>}
  </div>
}

const styles: Record<string, CSSProperties> = {
  root: { minWidth: 0, fontSize: 13 },
  group: { margin: "12px 0", padding: 10, minWidth: 0, border: `1px solid ${tokens.border}`, borderRadius: 8 },
  field: { display: "grid", gap: 5, marginBottom: 8, fontSize: 12 },
  input: { width: "100%", minWidth: 0, boxSizing: "border-box", padding: 6, border: `1px solid ${tokens.borderStrong}`, borderRadius: 5, background: tokens.bgElevated, color: tokens.text },
  note: { margin: "6px 0", color: tokens.textMuted, overflowWrap: "anywhere" },
  preview: { marginTop: 8, borderTop: `1px solid ${tokens.border}`, paddingTop: 6 },
  list: { padding: 0, margin: 0, listStyle: "none" },
}
