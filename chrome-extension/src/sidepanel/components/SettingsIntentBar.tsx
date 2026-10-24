/** AI semantic proposals; speech recognition only fills a draft. Writes require explicit review. */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { parseSettingsIntent, type SettingsIntent } from "../utils/settings-intent"
import type { SettingsSectionId } from "../utils/settings-sections"
import { requestSemanticSettings, semanticValue, type SemanticProposal, type SemanticReceiptItem } from "../utils/semantic-settings"
import { getSpeechRecognitionCtor, VOICE_DEFAULT_LANG } from "../voice/detect"
import { tokens } from "../ui/tokens"

export type SettingsIntentBarProps = {
  /** Existing explicit navigation only; semantic configuration never invokes regex mutations. */
  onIntent: (intent: SettingsIntent, isCurrent: () => boolean) => string | Promise<string>
  onOpenSection?: (section: SettingsSectionId) => void
  onOpenDestination?: (destination: "activity" | "todos") => void
  disabled?: boolean
  active?: boolean
}
export function SettingsIntentBar({ onIntent, onOpenSection, onOpenDestination, disabled, active = true }: SettingsIntentBarProps) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState<"propose" | "apply" | "navigate" | null>(null)
  const [proposal, setProposal] = useState<SemanticProposal | null>(null)
  const [candidateId, setCandidateId] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [receipt, setReceipt] = useState<SemanticReceiptItem[] | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState("")
  const recRef = useRef<{ stop: () => void; abort: () => void } | null>(null)
  const generationRef = useRef(0)
  const navigationOwnerRef = useRef({ active, disabled })
  // Invalidate the local navigation lease at render, before passive cleanup can run.
  if (navigationOwnerRef.current.active !== active || navigationOwnerRef.current.disabled !== disabled) {
    generationRef.current += 1
    navigationOwnerRef.current = { active, disabled }
  }
  const requestRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const cancel = () => {
      generationRef.current += 1
      const recognizer = recRef.current
      recRef.current = null
      try { recognizer?.abort() } catch { /* already ended */ }
      requestRef.current?.abort(); requestRef.current = null
    }
    if (!active || disabled) {
      if (requestRef.current) setError(busy === "apply" ? "已离开保存操作，结果尚未确认。请在原设置核对，不会自动重试。" : "理解请求已取消，输入已保留。")
      cancel(); setListening(false); setBusy(null); setStatus(previous => previous === "请描述希望改善的体验…" ? "语音输入已取消" : previous)
    }
    return cancel
  }, [active, disabled])

  const propose = useCallback(async () => {
    if (!text.trim() || disabled || !active || busy) return
    const controller = new AbortController(); requestRef.current?.abort(); requestRef.current = controller
    setBusy("propose"); setError(""); setStatus(null)
    try {
      const result = await requestSemanticSettings("settings.assistant.propose", { text: text.trim() }, controller.signal)
      if (controller.signal.aborted) return
      setProposal(result.proposal!); setReceipt(null); setSubmitted(false)
      const first = result.proposal!.candidates[0]
      setCandidateId(first?.id || ""); setSelected(first?.changes.map(change => change.id) || [])
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message) }
    finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(null) } }
  }, [text, disabled, active, busy])
  const apply = useCallback(async () => {
    if (!proposal || !selected.length || disabled || !active || busy || submitted) return
    const controller = new AbortController(); requestRef.current = controller
    setBusy("apply"); setSubmitted(true); setError(""); setStatus(null)
    try {
      const result = await requestSemanticSettings("settings.assistant.apply", { proposalId: proposal.id, candidateId, changeIds: selected, userConfirmed: true }, controller.signal)
      if (!controller.signal.aborted) setReceipt(result.items!)
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message + " 变更草稿已保留；请核对后重新生成。") }
    finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(null) } }
  }, [proposal, selected, disabled, active, busy, submitted, candidateId])
  const stopVoice = useCallback(() => {
    try { recRef.current?.stop() } catch { /* already ended */ }
    setListening(false)
  }, [])
  const startVoice = useCallback(() => {
    if (disabled || !active || listening || busy) return
    const Ctor = getSpeechRecognitionCtor(typeof globalThis !== "undefined" ? globalThis as any : {})
    if (!Ctor) { setStatus("此环境不支持语音识别，请直接输入描述"); return }
    const generation = ++generationRef.current, r = new Ctor()
    r.lang = VOICE_DEFAULT_LANG; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1
    r.onresult = (ev: any) => {
      if (generation !== generationRef.current) return
      const results = ev?.results
      if (!results) return
      let phrase = ""
      for (let i = 0; i < results.length; i++) phrase += results[i]?.[0]?.transcript || ""
      setText(phrase.trim())
    }
    r.onerror = () => { if (generation === generationRef.current) { setListening(false); recRef.current = null; setStatus("语音识别失败，请改用文字") } }
    r.onend = () => {
      if (generation !== generationRef.current) return
      setListening(false); recRef.current = null
      setStatus("语音已填入草稿。请检查文字，再点「生成候选」。")
    }
    recRef.current = r; setListening(true); setStatus("请描述希望改善的体验…")
    try { r.start() } catch { setListening(false); recRef.current = null; setStatus("无法启动麦克风") }
  }, [disabled, active, listening, busy])
  const navigateRule = async () => {
    if (disabled || !active || busy) return
    const generation = ++generationRef.current
    const isCurrent = () => generation === generationRef.current
    setBusy("navigate"); setError(""); setStatus(null)
    try {
      const result = await onIntent(rule, isCurrent)
      if (isCurrent()) setStatus(result)
    } catch { if (isCurrent()) setError("无法打开目标，请完成当前操作后再试。") }
    finally { if (isCurrent()) setBusy(null) }
  }
  const candidate = proposal?.candidates.find(item => item.id === candidateId)
  const rule = parseSettingsIntent(text)
  const canNavigateRule = rule.type === "open_meeting" || rule.type === "open_packs"
  return <div style={styles.wrap} data-testid="settings-intent-bar" aria-busy={!!busy}>
    <div style={styles.title}>描述目标，比较设置候选</div>
    <p style={styles.hint}>例如：语音错字太多；少打扰我，但别漏掉待办。AI 使用当前模型理解描述，只接收允许公开的设置目录和值。请勿输入密钥。</p>
    <div style={styles.row}>
      <input aria-label="描述设置目标" type="text" maxLength={2000} value={text} disabled={disabled || !!busy} placeholder="想改善什么体验？" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && text.trim() && !listening) { e.preventDefault(); void propose() } }} style={styles.input} />
      <button type="button" disabled={disabled || !!busy || listening || !text.trim()} style={styles.btn} onClick={() => void propose()}>{busy === "propose" ? "理解中…" : "生成候选"}</button>
      <button type="button" disabled={disabled || !!busy} style={{ ...styles.btn, ...(listening ? styles.btnLive : {}) }} onClick={() => listening ? stopVoice() : startVoice()} title="语音只填写描述，不自动修改设置">{listening ? "停止" : "语音"}</button>
    </div>
    {canNavigateRule && <button type="button" style={styles.btn} disabled={disabled || !!busy} onClick={() => void navigateRule()}>规则导航：{rule.type === "open_meeting" ? "打开会议" : "打开场景"}</button>}
    {status && <p role="status" style={styles.status}>{status}</p>}
    {error && <p role="alert" style={styles.error}>{error}</p>}
    {proposal && <div style={styles.proposal}>
      <p style={styles.title}>理解的目标：{proposal.intent}</p>
      {proposal.clarification && <p style={styles.hint}>{proposal.clarification}</p>}
      {proposal.candidates.map(item => <label key={item.id} style={{ ...styles.card, ...(item.id === candidateId ? styles.cardSelected : {}) }}>
        <input type="radio" name={`semantic-candidate-${proposal.id}`} checked={item.id === candidateId} disabled={!!busy || submitted || disabled} onChange={() => { setCandidateId(item.id); setSelected(item.changes.map(change => change.id)); setReceipt(null) }} />
        <span><strong>{item.title}</strong><span style={styles.block}>{item.reason}</span>{item.tradeoffs && <span style={styles.block}>影响与代价：{item.tradeoffs}</span>}</span>
      </label>)}
      {candidate && <>
        <p style={styles.hint}>勾选要提交的项目。标注「需单独操作」的项目只提供导航，不会自动更改。</p>
        {candidate.changes.map(change => <div key={change.id} style={styles.change}>
          <label style={styles.row}><input type="checkbox" checked={selected.includes(change.id)} disabled={!!busy || submitted || disabled} onChange={e => setSelected(ids => e.target.checked ? [...ids, change.id] : ids.filter(id => id !== change.id))} /><strong>{change.label}</strong><span>{change.scope === "manual" ? "需单独操作" : "可保存"}</span></label>
          <p style={styles.hint}>当前：{semanticValue(change.before)} → 建议：{semanticValue(change.after)}</p>
          <p style={styles.hint}>{change.reason}</p>
          {change.prerequisites.map(note => <p key={note} style={styles.hint}>{note}</p>)}
        </div>)}
        <button type="button" style={styles.btn} disabled={disabled || !!busy || submitted || !selected.length} onClick={() => void apply()}>{busy === "apply" ? "保存并核对…" : submitted ? "已提交，请核对回执" : `确认提交已勾选的 ${selected.length} 项`}</button>
        <p style={styles.hint}>候选约 5 分钟有效。保存前再次核对当前值；变化后需要重新生成。</p>
      </>}
      {receipt && <div role="status" aria-live="polite">{receipt.map(item => <div key={item.settingId} style={styles.change}><strong>{item.label} · {item.status === "saved" ? "已核对保存" : item.status === "manual" ? "待单独操作" : "未确认保存"}</strong><p style={styles.hint}>{item.message}{item.actual !== undefined && ` 当前读值：${semanticValue(item.actual)}`}</p>{item.status === "manual" && (item.destination ? onOpenDestination && <button type="button" style={styles.btn} onClick={() => onOpenDestination(item.destination!)}>打开{item.destination === "activity" ? "活动记录" : "待办"}核对</button> : onOpenSection && <button type="button" style={styles.btn} onClick={() => onOpenSection(item.section)}>打开对应设置核对</button>)}</div>)}</div>}
    </div>}
  </div>
}
const styles: Record<string, CSSProperties> = {
  wrap: { marginBottom: 14, padding: 10, borderRadius: 8, border: `1px solid ${tokens.border}`, background: tokens.bgMuted },
  title: { fontSize: 12, fontWeight: 600, color: tokens.text, marginBottom: 4, overflowWrap: "anywhere" },
  hint: { fontSize: 11, color: tokens.textMuted, lineHeight: 1.5, margin: "5px 0", overflowWrap: "anywhere" },
  row: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  input: { flex: "1 1 180px", minWidth: 0, fontSize: 12, padding: "6px 8px", borderRadius: 6, border: `1px solid ${tokens.borderStrong}`, background: tokens.bgElevated, color: tokens.text },
  btn: { fontSize: 11, padding: "6px 8px", borderRadius: 6, border: `1px solid ${tokens.borderStrong}`, background: tokens.bgElevated, color: tokens.text, cursor: "pointer", whiteSpace: "normal" },
  btnLive: { background: tokens.warningSoft, borderColor: tokens.warning },
  status: { marginTop: 6, fontSize: 11, color: tokens.accent, lineHeight: 1.5 },
  error: { marginTop: 6, fontSize: 11, color: tokens.danger, lineHeight: 1.5, overflowWrap: "anywhere" },
  proposal: { marginTop: 10 },
  card: { display: "flex", gap: 8, padding: 9, marginTop: 6, border: `1px solid ${tokens.border}`, borderRadius: 6, fontSize: 12, color: tokens.text, cursor: "pointer" },
  cardSelected: { borderColor: tokens.borderStrong, background: tokens.bgElevated },
  block: { display: "block", fontSize: 11, lineHeight: 1.5, color: tokens.textMuted, overflowWrap: "anywhere" },
  change: { padding: "8px 0", borderBottom: `1px solid ${tokens.border}`, fontSize: 11, color: tokens.text },
}
