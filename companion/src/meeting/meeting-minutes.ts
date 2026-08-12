/**
 * Generate structured meeting minutes via llmExtract (text-only job).
 */

import { llmExtract, type LlmExtractConfig } from "../llm/llm-extract"
import { logger } from "../logger"
import {
  buildMinutesSystemPrompt,
  MEETING_MINUTES_MAX_INPUT_CHARS,
  MEETING_MINUTES_MAX_TEMPLATE_CHARS,
  MEETING_MINUTES_TEMP_CAP,
  MEETING_MINUTES_TIMEOUT_MS,
} from "./minutes-prompt"
import type { MeetingMinutes } from "./meeting-store"

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
      .filter(Boolean)
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
  if (tmpl.length > MEETING_MINUTES_MAX_TEMPLATE_CHARS) {
    return { ok: false, code: "template_too_long", message: "template too long" }
  }
  if (params.signal?.aborted) {
    return { ok: false, code: "aborted", message: "aborted" }
  }

  const systemPrompt = buildMinutesSystemPrompt(tmpl || undefined)
  const extract = params.extract ?? llmExtract
  let out: string
  try {
    out = await extract({
      systemPrompt,
      userContent: raw,
      config: params.config,
      temperatureCap: MEETING_MINUTES_TEMP_CAP,
      timeout: MEETING_MINUTES_TIMEOUT_MS,
    })
  } catch (e: any) {
    if (params.signal?.aborted || e?.name === "AbortError") {
      return { ok: false, code: "aborted", message: "aborted" }
    }
    logger.warn("meeting.minutes.llm_failed", {
      err: e instanceof Error ? e.message : String(e),
      input_len: raw.length,
    })
    return {
      ok: false,
      code: "llm_error",
      message: e instanceof Error ? e.message : "llm failed",
    }
  }

  const md = (out || "").trim()
  if (!md) {
    return { ok: false, code: "empty_output", message: "empty minutes" }
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
  }
  logger.info("meeting.minutes.ok", {
    input_len: raw.length,
    output_len: md.length,
  })
  return { ok: true, minutes }
}
