import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { meetingAsrError, meetingAsrState, type MeetingAsrState } from "../voice/meeting-external-asr"
import { createMeetingRuntimeChannel } from "../voice/meeting-runtime-channel"

export function useMeetingAsrState(active: boolean) {
  const [snapshot, setSnapshot] = useState<MeetingAsrState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const channelRef = useRef<ReturnType<typeof createMeetingRuntimeChannel> | null>(null)

  const run = useCallback(async (message: Record<string, unknown>) => {
    channelRef.current?.destroy()
    let channel: ReturnType<typeof createMeetingRuntimeChannel> | undefined
    setBusy(true)
    setError("")
    try {
      channel = createMeetingRuntimeChannel(() => {}, () => {})
      channelRef.current = channel
      const reply = await channel.request(message)
      if (channelRef.current !== channel) return false
      const next = meetingAsrState(reply)
      if (!next) {
        setError(meetingAsrError(reply?.code))
        return false
      }
      setSnapshot(next)
      return true
    } catch {
      if (channelRef.current === channel || !channel) setError("无法核对会议转写设置，请检查 Companion 连接。")
      return false
    } finally {
      channel?.destroy()
      if (channelRef.current === channel || !channel) {
        channelRef.current = null
        setBusy(false)
      }
    }
  }, [])
  const refresh = useCallback(() => run({ type: "meeting.asr.get" }), [run])
  useEffect(() => {
    if (active && !channelRef.current) void refresh()
  }, [active, refresh])
  useEffect(() => () => { channelRef.current?.destroy(); channelRef.current = null }, [])
  return { snapshot, busy, error, refresh, save: run }
}

type Draft = {
  mode: MeetingAsrState["mode"]
  style: MeetingAsrState["style"]
  baseUrl: string
  model: string
  apiKey: string
  identity: string
}

export function MeetingExternalAsrSettings({ active = true, onFooterSave }: { active?: boolean; onFooterSave?: (control: { dirty: boolean; busy: boolean; save: () => Promise<boolean>; error?: string } | null) => void }) {
  const { state } = useAgentStore()
  const connected = state.connectionState === "connected"
  const { snapshot, busy, error, refresh, save } = useMeetingAsrState(active && connected)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState(false)
  const [validationError, setValidationError] = useState("")
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!onFooterSave) return
    onFooterSave(draft ? { dirty: true, busy: busy || !connected, error: validationError || error, save: async () => {
      if (!formRef.current?.checkValidity()) { setValidationError("请返回会议转写设置，填写完整且有效的信息。"); return false }
      return submit()
    } } : null)
    return () => onFooterSave(null)
  }, [active, draft, busy, connected, error, validationError, snapshot, onFooterSave])
  useEffect(() => {
    if (!state.settingsOpen || !connected) setDraft(previous => previous ? { ...previous, apiKey: "" } : previous)
  }, [state.settingsOpen, connected])

  const fields = draft ?? (snapshot ? {
    mode: snapshot.mode, style: snapshot.style, baseUrl: snapshot.baseUrl,
    model: snapshot.style === "openai" ? snapshot.model : "whisper-1",
    apiKey: "", identity: snapshot.configIdentity,
  } : null)
  const update = (changes: Partial<Draft>) => {
    if (fields) setDraft({ ...fields, ...changes })
    setSaved(false)
    setValidationError("")
  }
  const submit = async (clear = false) => {
    if (!fields || !connected || busy) return false
    const { mode, style, baseUrl, model, apiKey, identity } = fields
    setSaved(false)
    const changed = await save({
      type: "meeting.asr.set", source: "settings", expected_identity: identity,
      mode: clear ? "local" : mode,
      ...(clear ? { external: { apiKey: "" } } : mode === "external" ? {
        external: {
          style, baseUrl: baseUrl.trim(), ...(style === "openai" ? { model: model.trim() } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      } : {}),
    })
    if (changed) { setDraft(null); setSaved(true) }
    return changed
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  return <div data-model-center="meeting-asr" style={styles.root}>
    <p>会议麦克风与导入录音共用此转写设置。使用外部服务前，每次核对接收地址、模型和音频范围。</p>
    {!connected && <p role="status">连接 Companion 后可管理导入音频的转写服务。</p>}
    {busy && <p role="status">正在核对转写设置…</p>}
    {error && <p role="alert">{error}</p>}
    {validationError && <p role="alert">{validationError}</p>}
    {saved && <p role="status">已保存并核对会议转写设置。</p>}
    {snapshot && <p data-testid="meeting-asr-current" style={styles.target}>
      当前会议转写方式 · {snapshot.mode === "local" ? "本机转写" : snapshot.ready ? snapshot.model : "外部转写服务未就绪"}
      {snapshot.mode === "external" && snapshot.normalizedUrl && <><br />{snapshot.normalizedUrl}</>}
    </p>}
    {fields && <form ref={formRef} onSubmit={onSubmit} data-testid="meeting-asr-settings">
      <fieldset disabled={!connected || busy} style={styles.group}>
        <legend>会议与导入录音</legend>
        <label style={styles.field}>转写方式
          <select data-testid="meeting-asr-mode" value={fields.mode}
            onChange={event => update({ mode: event.target.value as Draft["mode"] })}>
            <option value="local">本机转写</option>
            <option value="external">外部转写服务</option>
          </select>
        </label>
        {fields.mode === "external" && <>
          <label style={styles.field}>服务协议
            <select value={fields.style} onChange={event => update({
              style: event.target.value as Draft["style"], baseUrl: "", apiKey: "",
            })}>
              <option value="deepseek">DeepSeek ASR</option>
              <option value="openai">OpenAI 兼容</option>
            </select>
          </label>
          <label style={styles.field}>服务地址
            <input value={fields.baseUrl} onChange={event => update({ baseUrl: event.target.value })}
              placeholder={fields.style === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1"} autoComplete="off" maxLength={2048} />
          </label>
          {fields.style === "openai" && <label style={styles.field}>模型名称
            <input value={fields.model} onChange={event => update({ model: event.target.value })} required maxLength={256} />
          </label>}
          <label style={styles.field}>会议转写密钥
            <input type="password" value={fields.apiKey} onChange={event => update({ apiKey: event.target.value })}
              placeholder={snapshot?.keyConfigured ? "使用已保存的密钥" : "请输入密钥"} autoComplete="new-password" maxLength={4096} />
          </label>
          <p>密钥保存在这台电脑的 Companion 配置文件中。保存设置时不会发送音频。</p>
        </>}
        <div style={styles.actions}>
          <button type="submit" disabled={!draft}>保存</button>
          {snapshot?.keyConfigured && fields.mode === "local" &&
            <button type="button" onClick={() => void submit(true)}>清除会议转写密钥</button>}
        </div>
      </fieldset>
    </form>}
    {connected && <button type="button" disabled={busy} onClick={() => {
      setDraft(null); setSaved(false); void refresh()
    }}>重新读取设置</button>}
  </div>
}

const styles: Record<string, CSSProperties> = {
  root: { display: "grid", gap: 8, justifyItems: "start", color: tokens.text, fontSize: 13 },
  target: { overflowWrap: "anywhere", color: tokens.textSecondary },
  group: { display: "grid", gap: 8, border: `1px solid ${tokens.border}`, borderRadius: 6, minInlineSize: 0 },
  field: { display: "grid", gap: 4 },
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
}
