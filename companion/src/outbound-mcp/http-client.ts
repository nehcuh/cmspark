/**
 * stdio mcp-outbound → Companion loopback HTTP dispatcher.
 */

import http from "http"
import {
  OUTBOUND_DISCLOSURE_PATH,
  OUTBOUND_INVOKE_PATH,
  OUTBOUND_HEALTH_PATH,
  OUTBOUND_PROFILE_PATH,
} from "./companion-http"
import type { OutboundDispatcher, OutboundDispatchRequest, OutboundDispatchResult } from "./bridge"

export type HttpClientOptions = {
  /** default 127.0.0.1 */
  host?: string
  /** companion port */
  port: number
  /** ws_secret bearer */
  token: string
  timeout_ms?: number
}

function requestJson(
  opts: HttpClientOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const timeout = opts.timeout_ms ?? 120_000
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8")
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: opts.host || "127.0.0.1",
        port: opts.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": payload.length,
              }
            : {}),
        },
        timeout,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          let parsed: any = null
          try {
            parsed = raw ? JSON.parse(raw) : null
          } catch {
            parsed = { ok: false, error: "invalid_json", raw: raw.slice(0, 200) }
          }
          resolve({ status: res.statusCode || 0, json: parsed })
        })
      },
    )
    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("outbound_http_timeout"))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

export async function companionOutboundHealth(
  opts: HttpClientOptions,
): Promise<{ ok: boolean; runner?: string }> {
  try {
    const r = await requestJson(opts, "GET", OUTBOUND_HEALTH_PATH)
    return { ok: r.status === 200, runner: r.json?.runner }
  } catch {
    return { ok: false }
  }
}

export async function companionPostDisclosure(
  opts: HttpClientOptions,
  caller_id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await requestJson(opts, "POST", OUTBOUND_DISCLOSURE_PATH, {
      caller_id,
      acknowledge: true,
    })
    if (r.status === 200 && r.json?.ok) return { ok: true }
    return {
      ok: false,
      error: r.json?.error || r.json?.error_code || `http_${r.status}`,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * #410 — ask the companion which profile this bearer (grant or ws_secret)
 * authorizes, so the stdio child advertises only the granted tool set.
 * Endpoint is authenticated (same auth matrix as invoke), so it cannot be
 * used to enumerate profiles without a valid key.
 */
export async function fetchCompanionOutboundProfile(opts: HttpClientOptions): Promise<
  | {
      ok: true
      profile: string
      /** Canonical tool names granted by the profile. */
      tools: string[]
    }
  | { ok: false; error?: string; http_status?: number }
> {
  try {
    const r = await requestJson(opts, "GET", OUTBOUND_PROFILE_PATH)
    if (r.status === 200 && r.json?.ok && typeof r.json.profile === "string") {
      return {
        ok: true,
        profile: r.json.profile,
        tools: Array.isArray(r.json.tools) ? r.json.tools.map(String) : [],
      }
    }
    return {
      ok: false,
      error: r.json?.error || r.json?.error_code || `http_${r.status}`,
      http_status: r.status,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function createHttpOutboundDispatcher(opts: HttpClientOptions): OutboundDispatcher {
  return async (req: OutboundDispatchRequest): Promise<OutboundDispatchResult> => {
    try {
      const r = await requestJson(opts, "POST", OUTBOUND_INVOKE_PATH, {
        caller_id: req.caller_id,
        tool: req.mcp_tool,
        args: req.args,
      })
      const j = r.json || {}
      if (j.ok === true) {
        return { success: true, data: j.data }
      }
      return {
        success: false,
        error: j.error || j.error_code || `http_${r.status}`,
      }
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) }
    }
  }
}
