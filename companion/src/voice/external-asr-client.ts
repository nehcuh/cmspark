// One external ASR POST. lookup decides whether this attempt is made.
// Resolved addresses are not written into the connection. This check does not
// pin the socket and does not remove DNS rebinding.

import { lookup as dnsLookup } from "node:dns/promises"
import type { ExternalAsrStyle } from "./external-asr-url"
import { isBlockedResolvedAddress, isLiteralAddress } from "./external-asr-url"

export interface ExternalLookupAnswer {
  address: string
  family: number
}

export interface ExternalFetchInit {
  method: "POST"
  redirect: "error"
  headers: { Authorization: string }
  body: FormData
  signal: AbortSignal
}

export interface ExternalFetchResponse {
  status?: number
  json?: () => Promise<unknown>
}

export type ExternalTranscribeCode =
  | "aborted"
  | "external_timeout"
  | "external_redirect"
  | "external_bad_response"
  | "external_empty"
  | "external_unreachable"
  | "external_rejected"
  | "external_unauthorized"
  | "external_endpoint"
  | "external_too_large"
  | "external_rate_limited"
  | "external_unavailable"

export type ExternalTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; code: ExternalTranscribeCode }

export interface ExternalTranscribeRequest {
  style: ExternalAsrStyle
  url: string
  apiKey: string
  wav: Uint8Array
  model?: string
  language?: string
  timeoutMs: number
  signal: AbortSignal
  fetchImpl?: (url: string, init: ExternalFetchInit) => Promise<ExternalFetchResponse>
  lookup?: (hostname: string) => Promise<ExternalLookupAnswer[]>
}

const UNREACHABLE: ExternalTranscribeResult = { ok: false, code: "external_unreachable" }

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, "")
  } catch {
    return null
  }
}

async function defaultLookup(hostname: string): Promise<ExternalLookupAnswer[]> {
  const rows = await dnsLookup(hostname, { all: true })
  return rows.map((row) => ({
    address: row.address,
    family: row.family === 6 ? 6 : 4,
  }))
}

function linkDeadline(parent: AbortSignal, timeoutMs: number) {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, timeoutMs)
  const onParent = () => ctl.abort()
  if (parent.aborted) ctl.abort()
  else parent.addEventListener("abort", onParent)
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    cancel() {
      clearTimeout(timer)
      parent.removeEventListener("abort", onParent)
    },
  }
}

function statusCode(status: number): ExternalTranscribeCode {
  if (status === 408 || status === 504) return "external_timeout"
  if (status === 401 || status === 403) return "external_unauthorized"
  if (status === 404) return "external_endpoint"
  if (status === 413) return "external_too_large"
  if (status === 429) return "external_rate_limited"
  if (status === 500 || status === 502 || status === 503) return "external_unavailable"
  return "external_rejected"
}

function failureCode(parent: AbortSignal, timedOut: boolean): ExternalTranscribeResult {
  if (parent.aborted) return { ok: false, code: "aborted" }
  if (timedOut) return { ok: false, code: "external_timeout" }
  return UNREACHABLE
}

export async function transcribeExternal(req: ExternalTranscribeRequest): Promise<ExternalTranscribeResult> {
  if (req.signal.aborted) return { ok: false, code: "aborted" }
  const host = hostOf(req.url)
  if (!host) return UNREACHABLE
  if (isLiteralAddress(host)) {
    if (isBlockedResolvedAddress(host)) return UNREACHABLE
  } else {
    let answers: ExternalLookupAnswer[]
    try {
      answers = await (req.lookup ?? defaultLookup)(host)
    } catch {
      return UNREACHABLE
    }
    if (req.signal.aborted) return { ok: false, code: "aborted" }
    if (answers.length === 0 || answers.some((row) => isBlockedResolvedAddress(row.address))) {
      return UNREACHABLE
    }
  }
  if (req.signal.aborted) return { ok: false, code: "aborted" }

  const deadline = linkDeadline(req.signal, req.timeoutMs)
  const form = new FormData()
  const bytes = new Uint8Array(req.wav.byteLength)
  bytes.set(req.wav)
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "audio.wav")
  if (req.style === "openai") {
    form.append("model", req.model ?? "")
    if (req.language) form.append("language", req.language)
    form.append("response_format", "json")
  }
  const doFetch = req.fetchImpl ?? ((url: string, init: ExternalFetchInit) => fetch(url, init))
  try {
    const res = await doFetch(req.url, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${req.apiKey}` },
      body: form,
      signal: deadline.signal,
    })
    if (req.signal.aborted || deadline.timedOut()) return failureCode(req.signal, deadline.timedOut())
    if (typeof res.status === "number" && res.status >= 300 && res.status < 400) {
      return { ok: false, code: "external_redirect" }
    }
    if (typeof res.status === "number" && (res.status < 200 || res.status >= 300)) {
      return { ok: false, code: statusCode(res.status) }
    }
    if (typeof res.json !== "function") return { ok: false, code: "external_bad_response" }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, code: "external_bad_response" }
    }
    if (req.signal.aborted || deadline.timedOut()) return failureCode(req.signal, deadline.timedOut())
    const text = body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
      ? (body as { text: string }).text
      : null
    if (text == null) return { ok: false, code: "external_bad_response" }
    if (text.trim() === "") return { ok: false, code: "external_empty" }
    return { ok: true, text }
  } catch {
    return failureCode(req.signal, deadline.timedOut())
  } finally {
    deadline.cancel()
  }
}
