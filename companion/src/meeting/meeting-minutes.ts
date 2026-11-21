/**
 * Generate structured meeting minutes via llmExtract (text-only job).
 */

import { llmExtract, type LlmExtractConfig } from "../llm/llm-extract"
import { logger } from "../logger"
import {
  buildMinutesSystemPrompt,
  buildReferenceMinutesSystemPrompt,
  MEETING_MINUTES_CITATION_RULE,
  MEETING_MINUTES_MAX_INPUT_CHARS,
  MEETING_MINUTES_MAX_TEMPLATE_CHARS,
  MEETING_MINUTES_TEMP_CAP,
  MEETING_MINUTES_TIMEOUT_MS,
} from "./minutes-prompt"
import { meetingSourceFingerprint, type MeetingMinutes } from "./meeting-store"
import { MEETING_REFERENCE_MAX_CHARS, parseReferenceMinutes } from "./meeting-reference"
import { estimateTokens } from "../file-chunker"
import { groundDefaultMinutes } from "./minutes-evidence"

export type GenerateMinutesResult =
  | { ok: true; minutes: MeetingMinutes }
  | { ok: false; code: string; message: string }

function parseLooseSections(md: string): Partial<MeetingMinutes> {
  const tldr = md.match(/###\s*TL;DR\s*\n([\s\S]*?)(?=\n###\s|$)/i)?.[1]?.trim()
  const decisionsBlock = md.match(/###\s*决议\s*\n([\s\S]*?)(?=\n###\s|$)/i)?.[1]
  const actionsBlock = md.match(/###\s*待办\s*\n([\s\S]*?)(?=\n###\s|$)/i)?.[1]
  const risksBlock = md.match(/###\s*风险[^\n]*\n([\s\S]*?)(?=\n###\s|$)/i)?.[1]
  const bullets = (block?: string) =>
    (block || "")
      .split("\n")
      .map((l) => l.replace(/^\s*[-*]\s*(\[[ xX]\]\s*)?/, "").trim())
      .filter(line => line && line !== "无可核对的条目。")
  return {
    tldr,
    decisions: bullets(decisionsBlock),
    actions: bullets(actionsBlock),
    risks: bullets(risksBlock),
  }
}

export async function generateMeetingMinutes(params: {
  transcriptText: string
  config: LlmExtractConfig
  /** Optional user markdown template (structure only; safety rules always win). */
  templateMd?: string
  referenceNotes?: string
  referenceName?: string
  extract?: typeof llmExtract
  signal?: AbortSignal
}): Promise<GenerateMinutesResult> {
  const raw = (params.transcriptText || "").trim()
  if (!raw) {
    return { ok: false, code: "empty_transcript", message: "empty transcript" }
  }
  if (raw.length > MEETING_MINUTES_MAX_INPUT_CHARS) {
    return { ok: false, code: "transcript_too_long", message: "transcript too long" }
  }
  const tmpl = params.templateMd?.trim() || ""
  const referenceNotes = params.referenceNotes?.trim() || ""
  const referenceName = params.referenceName?.trim() || ""
  if (referenceNotes.length > MEETING_REFERENCE_MAX_CHARS || raw.length + referenceNotes.length > MEETING_MINUTES_MAX_INPUT_CHARS) {
    return { ok: false, code: "reference_too_long", message: "转写与参考笔记合计不能超过 200000 字，参考笔记不能超过 100000 字" }
  }
  if (tmpl.length > MEETING_MINUTES_MAX_TEMPLATE_CHARS) {
    return { ok: false, code: "template_too_long", message: "template too long" }
  }
  if (params.signal?.aborted) {
    return { ok: false, code: "aborted", message: "aborted" }
  }

  const systemPrompt = referenceNotes ? buildReferenceMinutesSystemPrompt(tmpl || undefined)
    : tmpl ? buildMinutesSystemPrompt(tmpl) : `${buildMinutesSystemPrompt()}\n\n${MEETING_MINUTES_CITATION_RULE}`
  const userContent = referenceNotes ? JSON.stringify({ transcript: raw, reference_notes: referenceNotes, reference_name: referenceName }) : raw
  if (referenceNotes) {
    const contextWindow = params.config.context_window ?? 100_000
    const outputReserve = Math.min(params.config.max_tokens ?? 4096, Math.floor(contextWindow / 4))
    if (Number.isFinite(contextWindow) && estimateTokens(systemPrompt) + estimateTokens(userContent) + outputReserve + 128 > contextWindow) {
      return { ok: false, code: "context_too_small", message: "完整转写和参考笔记超过当前模型上下文，请精简材料或选择更大上下文；未截断任何材料" }
    }
  }
  const extract = params.extract ?? llmExtract
  let out: string
  try {
    out = await extract({
      systemPrompt,
      userContent,
      config: { ...params.config, rejectRedirects: true },
      temperatureCap: MEETING_MINUTES_TEMP_CAP,
      timeout: MEETING_MINUTES_TIMEOUT_MS,
      signal: params.signal,
    })
  } catch (e: any) {
    if (params.signal?.aborted || e?.name === "AbortError") {
      return { ok: false, code: "aborted", message: "aborted" }
    }
    // A service can reflect credentials or source material in its error body.
    const status = typeof e?.status === "number" && Number.isInteger(e.status) && e.status >= 400 && e.status <= 599 ? e.status : undefined
    logger.warn("meeting.minutes.llm_failed", { status, input_len: raw.length })
    return {
      ok: false,
      code: "llm_error",
      message: status === 401 || status === 403
        ? "纪要模型拒绝了请求，请检查服务密钥和模型权限后重试"
        : "纪要模型请求失败，请检查模型设置或稍后重试",
    }
  }

  if (params.signal?.aborted) return { ok: false, code: "aborted", message: "aborted" }
  const referenceResult = referenceNotes ? parseReferenceMinutes(out || "", raw, referenceNotes) : undefined
  if (referenceNotes && !referenceResult) {
    return { ok: false, code: "invalid_reference_result", message: "纪要校正结果缺少有效的原文或参考依据，请重试；原始转写已保留" }
  }
  const responseMd = referenceResult?.raw_md || (out || "").trim()
  if (!responseMd) {
    return { ok: false, code: "empty_output", message: "empty minutes" }
  }
  const md = referenceNotes || tmpl ? responseMd : groundDefaultMinutes(responseMd, raw)
  if (!md) {
    return { ok: false, code: "invalid_minutes_evidence", message: "模型未提供可核对的逐字稿依据，请重试或更换纪要模型。未写入本次结果。" }
  }
  // Soft structure check — require at least TL;DR heading
  if (!/###\s*TL;DR/i.test(md)) {
    logger.info("meeting.minutes.missing_tldr", { output_len: md.length })
  }

  const partial = parseLooseSections(md)
  const minutes: MeetingMinutes = {
    tldr: partial.tldr,
    decisions: partial.decisions,
    actions: partial.actions,
    risks: partial.risks,
    raw_md: md,
    generated_at: new Date().toISOString(),
    source_transcript: raw,
    source_fingerprint: meetingSourceFingerprint(raw, referenceNotes, referenceName),
    stale: false,
    ...referenceResult,
  }
  logger.info("meeting.minutes.ok", {
    input_len: raw.length,
    output_len: md.length,
  })
  return { ok: true, minutes }
}
