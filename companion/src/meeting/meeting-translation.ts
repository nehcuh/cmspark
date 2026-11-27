import { randomUUID, createHash } from "node:crypto"
import { getConfigSnapshot } from "../config"
import { llmExtract } from "../llm/llm-extract"
import { displayModelEndpoint, resolveMeetingTextModel } from "../model-center"
import { assertLlmEndpointUrlAllowed } from "../security"
import { isSafeMeetingId } from "./meeting-paths"
import { loadMeeting, readMeetingTranslations, writeMeetingTranslations, type SavedTranslation } from "./meeting-store"

const languages = new Set(["简体中文", "繁體中文", "English", "日本語", "한국어", "Français", "Deutsch", "Español"])
const maxText = 16_000
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const hasText = (value: unknown, limit: number) => typeof value === "string" && !!value.trim() && value.length <= limit

export function validTranslationRequest(m: any): boolean {
  if (m.v !== 1 || !hasText(m.id, 200)) return false
  const base = ["type", "id", "v"]
  const only = (...keys: string[]) => Object.keys(m).every(key => base.includes(key) || keys.includes(key))
  if (m.type === "meeting.translation.list") return only("meeting_id") && isSafeMeetingId(m.meeting_id)
  if (m.type === "meeting.translation.cancel") return only("token") && hasText(m.token, 64)
  if (!languages.has(m.language)) return false
  const meeting = m.meeting_id !== undefined
  if (meeting ? !isSafeMeetingId(m.meeting_id) : !hasText(m.text, maxText)) return false
  const scope = ["language", meeting ? "meeting_id" : "text"]
  if (m.type === "meeting.translation.prepare") return only(...scope)
  return m.type === "meeting.translation.run" && hasText(m.token, 64) && (meeting
    ? only(...scope, "token", "segment_id", "version") && hasText(m.segment_id, 200) && typeof m.version === "string" && /^[a-f0-9]{64}$/.test(m.version)
    : only(...scope, "token"))
}

function configuredReceiver() {
  const snapshot = getConfigSnapshot()
  const resolved = resolveMeetingTextModel(snapshot)
  if (!resolved || assertLlmEndpointUrlAllowed(resolved.llm.base_url)) return null
  return { ...resolved, revision: snapshot.revision }
}

function segments(meetingId: string, dataDir?: string) {
  const meeting = loadMeeting(meetingId, dataDir)
  if (!meeting) return
  const explicitIds = new Set(meeting.transcript.map(line => line.segment_id))
  return meeting.transcript.map((line, index) => {
    // The existing editor and stop-time segmentation round-trip plain text.
    // Recover the original identity when the same utterance still occupies its slot.
    const original = meeting.original_transcript?.[index]
    const archivedId = original?.text === line.text && !explicitIds.has(original.segment_id) ? original.segment_id : undefined
    return { id: line.segment_id || archivedId || `line:${index}`, version: hash(line.text), text: line.text, t0: line.t0 ?? (archivedId ? original?.t0 : undefined), speaker: line.speaker }
  })
}

type Permit = { peer: string; scope: string; expires: number; busy?: AbortController }

export function createTranslationService(receiver = configuredReceiver, extract = llmExtract, dataDir?: string) {
  const permits = new Map<string, Permit>()
  function revoke(token: string) {
    permits.get(token)?.busy?.abort()
    permits.delete(token)
  }
  return {
    disconnect(peer: string) {
      for (const [token, permit] of permits) if (permit.peer === peer) revoke(token)
    },
    async handle(m: any, peer?: string) {
      const error = (code: string, message: string) => ({ type: "meeting.translation.error", v: 1, id: m.id, code, message })
      const reply = (name: string, fields: object = {}) => ({ type: `meeting.translation.${name}`, v: 1, id: m.id, ...fields })
      if (!peer || !validTranslationRequest(m)) return error("invalid", "翻译请求无效")
      if (m.type === "meeting.translation.cancel") {
        if (permits.get(m.token)?.peer === peer) revoke(m.token)
        return reply("cancelled")
      }
      const rows = m.meeting_id ? segments(m.meeting_id, dataDir) : undefined
      if (m.meeting_id && !rows) return error("not_found", "会议已删除")
      if (m.type === "meeting.translation.list") {
        const saved = readMeetingTranslations(m.meeting_id, dataDir)
        return reply("listed", { segments: rows, translations: saved })
      }
      const target = receiver()
      if (!target) return error("model_missing", "请在模型与服务中配置会议文本模型")
      const scope = hash(JSON.stringify([target, m.language, m.meeting_id ?? null, m.text ?? null]))
      if (m.type === "meeting.translation.prepare") {
        for (const [key, permit] of permits) if (permit.expires <= Date.now() && !permit.busy) revoke(key)
        if (permits.size >= 128) return error("busy", "翻译请求过多，请稍后重试")
        const token = randomUUID()
        permits.set(token, { peer, scope, expires: Date.now() + 5 * 60_000 })
        return reply("prepared", { token, model: target.llm.model_name, endpoint: displayModelEndpoint(target.llm.base_url), profile: target.profileName })
      }
      const permit = permits.get(m.token)
      if (!permit || permit.peer !== peer || permit.scope !== scope || permit.expires <= Date.now()) {
        if (permit?.peer === peer) revoke(m.token)
        return error("consent_changed", "材料、授权或模型配置已变化，请重新确认接收方")
      }
      if (permit.busy) return error("busy", "上一段仍在翻译")
      const row = rows?.find(item => item.id === m.segment_id)
      if (rows && (!row || row.version !== m.version)) return error("stale", "转写已更新，请翻译当前版本")
      if (row) {
        const cached = readMeetingTranslations(m.meeting_id, dataDir).find(item =>
          item.id === row.id && item.version === row.version && item.language === m.language)
        if (cached) return reply("result", { entry: cached })
      }
      const source = row?.text ?? m.text
      if (!hasText(source, maxText)) return error("too_long", "单段翻译限 16000 字，请分段后重试")
      const controller = new AbortController()
      permit.busy = controller
      permit.expires = Date.now() + 60 * 60_000
      try {
        const text = (await extract({
          systemPrompt: `Translate the supplied text into ${m.language}. Preserve its meaning and formatting. Return only the translation.`,
          userContent: source, config: { ...target.llm, rejectRedirects: true }, signal: controller.signal,
        })).trim()
        if (controller.signal.aborted) return error("cancelled", "已取消翻译")
        if (!text || text.length > 64_000) return error("output_invalid", "模型未返回有效译文，请重试")
        if (row) {
          const current = segments(m.meeting_id, dataDir)
          if (!current?.some(item => item.id === row.id && item.version === row.version)) return error("stale", "转写已更新，请翻译当前版本")
          const entry: SavedTranslation = { id: row.id, version: row.version, language: m.language, text, model: target.llm.model_name }
          const versions = new Map(current.map(item => [item.id, item.version]))
          const saved = readMeetingTranslations(m.meeting_id, dataDir).filter(item =>
            versions.get(item.id) === item.version && !(item.id === entry.id && item.language === entry.language))
          writeMeetingTranslations(m.meeting_id, [...saved, entry], dataDir)
          return reply("result", { entry })
        }
        return reply("result", { text })
      } catch {
        return error(controller.signal.aborted ? "cancelled" : "failed", controller.signal.aborted ? "已取消翻译" : "翻译或保存失败，原文已保留，请重试")
      } finally {
        permit.busy = undefined
        if (!m.meeting_id) revoke(m.token)
      }
    },
  }
}
