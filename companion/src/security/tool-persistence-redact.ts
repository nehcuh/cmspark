/**
 * Redact sensitive tool params/results before durable thread JSON persistence.
 *
 * Thread JSON redaction (audit SEC-C / item 3; scope revised by #255): cookies,
 * exec-tier tools (shell, host_*, osascript, workspace_*), MCP secrets, and
 * sensitive keys (incl. passwd / Authorization) must not land in
 * ~/.cmspark-agent/threads/*.json. Read-tier tools (get_page_text /
 * get_page_html / evaluate) persist a gate-checked prefix so a reloaded thread
 * keeps the page context the model read (#255: full collapse caused reload
 * amnesia). ALL rules live in the shared module security/redact-rules.ts —
 * history/store.ts consumes the same one (golden fixtures + lock-step tests
 * pin parity). In-flight LLM tool rows stay unredacted; only
 * createToolResultMessage → addMessage (tool-role) and
 * persistAssistantDraft → addMessage (assistant tool_calls.arguments)
 * go through here.
 */
import {
  EXEC_FOLD_TOOLS,
  MCP_SENSITIVE_RESULT_RE,
  MCP_TOOL_PREFIX,
  READ_RELEASE_TOOLS,
  SENSITIVE_COOKIE_TOOLS,
  readReleaseBlocked,
  redactCodeishParams,
  redactSensitiveKeysDeep,
  releaseReadData,
  shortHash,
} from "./redact-rules"

function redactCookieData(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((cookie) => redactOneCookie(cookie))
  }
  if (data && typeof data === "object") {
    return redactOneCookie(data)
  }
  // Mirror history/store redactCookieSummary: blank non-object/array rather than
  // passthrough (future tool shapes must not leak raw cookie strings).
  return null
}

function redactOneCookie(cookie: unknown): unknown {
  if (!cookie || typeof cookie !== "object") return cookie
  const c = cookie as Record<string, unknown>
  const { name, domain, path: cookiePath, hostOnly, secure, httpOnly, value, ...rest } = c
  const valueStr = typeof value === "string" ? value : ""
  const restRedacted = redactSensitiveKeysDeep(
    Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "value")),
  ) as Record<string, unknown>
  return {
    name,
    domain,
    path: cookiePath,
    hostOnly,
    secure,
    httpOnly,
    ...restRedacted,
    ...(valueStr
      ? { value_hash: shortHash(valueStr), value_length: valueStr.length }
      : {}),
  }
}

function redactComputerParams(params: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...params }
  if (typeof redacted.task === "string") {
    redacted.task = `<redacted:hash=${shortHash(redacted.task)},len=${redacted.task.length}>`
  }
  if (typeof redacted.security_token === "string") {
    redacted.security_token = `<redacted:hash=${shortHash(redacted.security_token)},len=${redacted.security_token.length}>`
  }
  if (Array.isArray(redacted.actions)) {
    redacted.actions = redacted.actions.map((a: any) => {
      if (!a || typeof a !== "object") return a
      const copy = { ...a }
      if (typeof copy.text === "string") {
        copy.text = `<redacted:hash=${shortHash(copy.text)},len=${copy.text.length}>`
      }
      return copy
    })
  }
  return redacted
}

function collapseResult(result: unknown): { success?: boolean; redacted: true; len: number; sha256: string } {
  const raw = typeof result === "string" ? result : JSON.stringify(result ?? null)
  return {
    success: typeof result === "object" && result && "success" in (result as any)
      ? Boolean((result as any).success)
      : undefined,
    redacted: true,
    len: raw.length,
    sha256: shortHash(raw),
  }
}

/**
 * Data-less error rows ({success:false, error, error_code?} — the shape of the
 * INTERRUPTED heal fillers from tool-batch-heal) carry no sensitive payload.
 * Sensitive branches below would rebuild the row without error_code (codeish) or
 * collapse away error entirely (collapseResult), destroying the INTERRUPTED
 * marker the heal/rebuild flow keys on. Reconstructs a fresh object (no extra
 * keys), else null.
 */
function plainErrorResult(
  result: unknown,
): { success: false; error: string; error_code?: string } | null {
  if (!result || typeof result !== "object") return null
  const r = result as Record<string, unknown>
  if (r.success !== false || typeof r.error !== "string") return null
  if (r.data !== undefined) return null
  // Reconstruct — never return the original object (extra keys like
  // stdout / env / stack would otherwise persist next to INTERRUPTED).
  const out: { success: false; error: string; error_code?: string } = {
    success: false,
    error: r.error,
  }
  if (typeof r.error_code === "string") out.error_code = r.error_code
  return out
}

/**
 * Returns params + result safe for durable thread JSON (and content string).
 * Non-sensitive tools pass through (params deep-key scan only for MCP).
 */
export function redactToolPayloadForPersistence(
  toolName: string,
  params: unknown,
  result: unknown,
): { params: unknown; result: unknown } {
  const name = typeof toolName === "string" ? toolName : ""
  let safeParams = params
  let safeResult = result

  if (name === "thread_recall") {
    const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {}
    const q = typeof p.query === "string" ? p.query : ""
    safeParams = {
      query_len: q.length,
      ...(typeof p.max_hits === "number" ? { max_hits: p.max_hits } : {}),
      query: `<redacted:len=${q.length}:sha256=${shortHash(q)}>`,
    }
    safeResult = plainErrorResult(result) ?? collapseResult(result)
    return { params: safeParams, result: safeResult }
  }

  if (SENSITIVE_COOKIE_TOOLS.has(name)) {
    if (params && typeof params === "object") {
      const original = params as Record<string, unknown>
      const p = redactSensitiveKeysDeep({ ...original }) as Record<string, unknown>
      if (typeof original.value === "string") {
        p.value = `<redacted:hash=${shortHash(original.value)}>`
      }
      safeParams = p
    }
    // ToolExecutionResult shape: { success, data?, error? }
    if (result && typeof result === "object") {
      const r = result as Record<string, unknown>
      safeResult = {
        ...r,
        data: r.data !== undefined ? redactCookieData(r.data) : undefined,
      }
    } else {
      safeResult = collapseResult(result)
    }
    return { params: safeParams, result: safeResult }
  }

  if (name === "host_computer") {
    if (params && typeof params === "object") {
      safeParams = redactComputerParams(params as Record<string, unknown>)
    }
    safeResult = plainErrorResult(result) ?? collapseResult(result)
    return { params: safeParams, result: safeResult }
  }

  // #255 read tier: gate-checked prefix release (完整 / 截断), fail-closed
  // collapse on any gate hit (折叠).
  if (READ_RELEASE_TOOLS.has(name)) {
    // Params are ALWAYS folded (evaluate code / security_token); page read
    // tools carry only selector/tabId — deep-key scan suffices.
    if (name === "evaluate" && params && typeof params === "object") {
      safeParams = redactCodeishParams(params as Record<string, unknown>)
    } else if (params !== undefined) {
      safeParams = redactSensitiveKeysDeep(params)
    }
    if (result && typeof result === "object") {
      const plainError = plainErrorResult(result)
      if (plainError) {
        // INTERRUPTED-style row: no data payload — keep error_code + error verbatim.
        safeResult = plainError
      } else {
        const r = result as Record<string, unknown>
        const dataStr = r.data !== undefined ? JSON.stringify(r.data) : ""
        safeResult = {
          success: r.success,
          // Keep the passthrough shape: error/data keys only when present
          // (reloaded read-tier rows must deep-equal their generic-branch
          // ancestors for linkage/UI tests).
          ...(r.error !== undefined
            ? {
                error: typeof r.error === "string" && r.error.length > 200
                  ? r.error.slice(0, 200) + "…"
                  : r.error,
              }
            : {}),
          ...(r.data !== undefined
            ? {
                data: readReleaseBlocked(name, params, dataStr)
                  ? { redacted: true, len: dataStr.length, sha256: shortHash(dataStr) }
                  : releaseReadData(r.data),
              }
            : {}),
        }
      }
    }
    return { params: safeParams, result: safeResult }
  }

  if (EXEC_FOLD_TOOLS.has(name)) {
    if (params && typeof params === "object") {
      safeParams = redactCodeishParams(params as Record<string, unknown>)
    }
    // Keep success/error structure; collapse large data
    if (result && typeof result === "object") {
      const plainError = plainErrorResult(result)
      if (plainError) {
        // INTERRUPTED-style row: no data payload — keep error_code + error verbatim.
        safeResult = plainError
      } else {
        const r = result as Record<string, unknown>
        const dataStr = r.data !== undefined ? JSON.stringify(r.data) : ""
        safeResult = {
          success: r.success,
          error: typeof r.error === "string" && r.error.length > 200
            ? r.error.slice(0, 200) + "…"
            : r.error,
          // Always collapse payload for shell/host_*/workspace_* — a 200-char
          // cookie/source snippet is still a secret on disk.
          data:
            r.data !== undefined
              ? { redacted: true, len: dataStr.length, sha256: shortHash(dataStr) }
              : undefined,
        }
      }
    }
    return { params: safeParams, result: safeResult }
  }

  if (name.startsWith(MCP_TOOL_PREFIX)) {
    if (params !== undefined) {
      safeParams = redactSensitiveKeysDeep(params)
    }
    if (MCP_SENSITIVE_RESULT_RE.test(name)) {
      safeResult = plainErrorResult(result) ?? collapseResult(result)
    } else {
      safeResult = redactSensitiveKeysDeep(result)
    }
    return { params: safeParams, result: safeResult }
  }

  // Generic: deep-key scan only
  if (params !== undefined) {
    safeParams = redactSensitiveKeysDeep(params)
  }
  if (result !== undefined) {
    safeResult = redactSensitiveKeysDeep(result)
  }
  return { params: safeParams, result: safeResult }
}

/**
 * #502 B archive tier.
 *
 * Wraps the redaction SoT above and then, when `persistFull` is false (the
 * product default), collapses the NON-SENSITIVE payload to an audit stub:
 *
 *   result: { success?, redacted: true, len, sha256 }
 *   params: { redacted: true, len, sha256 }
 *
 * Shape reuse is deliberate: the side panel already recognises this envelope
 * (redacted-stub-utils `extractRedactedStub`, shapes A/B) and renders it as
 * "出于安全未持久化", so a compacted archive needs no new UI dialect.
 *
 * CARVE-OUTS (apply in BOTH modes):
 *  - Sensitive classes keep their own #255 handling — cookie values, exec /
 *    host / osascript bodies and MCP secrets are folded by the SoT call above,
 *    and collapsing on top of that is strictly less data. The switch therefore
 *    only ever decides whether a NON-sensitive body is written, never whether a
 *    secret is redacted.
 *  - FAILURE results (#511) keep their DIAGNOSTIC, not their body: bounded
 *    `error`, `error_code`, and machine `data` keys (unlock contract:
 *    SITE_OP_BANNED's `data.error_code` / `suggested_action`, the heal flow's
 *    `error_code: INTERRUPTED`) survive plus a fingerprint; business payloads
 *    riding a failure (fill values in `data.filled` / `params.fields[]`, page
 *    text) are stubbed exactly like success bodies. Non-standard shapes with no
 *    explicit `success` stub the same way — fail-closed, never fail-open.
 *
 * Only `success === true` payloads are compacted to the bare fingerprint — that
 * is the page text / DOM / form fill / screenshot body the ticket is about.
 *
 * Params are stubbed as well: they are the same intermediate operation as the
 * result (the selector typed into, the fill value, the URL fetched), and this
 * ticket's goal is "tool name + success + size + fingerprint only". The row
 * itself — including tool_name and the tool_call id — is never dropped.
 */
export function archiveToolPayload(
  toolName: string,
  params: unknown,
  result: unknown,
  persistFull: boolean,
): { params: unknown; result: unknown } {
  // Redaction first, unconditionally: the switch never bypasses a fold.
  const safe = redactToolPayloadForPersistence(toolName, params, result)
  if (persistFull) return safe
  // #511: failure envelopes keep the diagnostic surface, never the body.
  if (!isSuccessfulResult(safe.result)) {
    return {
      params: safe.params === undefined ? undefined : stubPayload(safe.params),
      result: safe.result === undefined ? undefined : stubFailureResult(safe.result),
    }
  }
  return {
    params: safe.params === undefined ? undefined : stubPayload(safe.params),
    result: safe.result === undefined ? undefined : collapseResult(safe.result),
  }
}

/**
 * Only an explicit `success: true` is a compactable body. Anything else is
 * treated as a diagnostic envelope (including a missing `success` field, which
 * the tool layer only ever omits on non-standard shapes) — stubbed with the
 * bounded diagnostic kept (#511).
 */
function isSuccessfulResult(result: unknown): boolean {
  return !!result && typeof result === "object" && (result as { success?: unknown }).success === true
}

/**
 * #511: stub a failure (or non-standard) result envelope. Keeps the bounded
 * diagnostic surface the model and heal flow key on — boolean `success`,
 * `error` (≤200 chars), `error_code`, machine `data` keys
 * ({error_code, suggested_action, tab_url}) — plus the {redacted, len, sha256}
 * fingerprint of the original envelope. Business payloads riding a failure
 * (fill values, page text) are dropped like success bodies.
 */
function stubFailureResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") {
    return stubPayload(result)
  }
  const r = result as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (typeof r.success === "boolean") out.success = r.success
  if (typeof r.error === "string") {
    out.error = r.error.length > 200 ? r.error.slice(0, 200) + "…" : r.error
  }
  if (typeof r.error_code === "string") out.error_code = r.error_code
  if (r.data && typeof r.data === "object") {
    const d = r.data as Record<string, unknown>
    const machine: Record<string, unknown> = {}
    for (const key of ["error_code", "suggested_action", "tab_url"]) {
      if (typeof d[key] === "string") machine[key] = d[key]
    }
    if (Object.keys(machine).length > 0) out.data = machine
  }
  const raw = JSON.stringify(result)
  out.redacted = true
  out.len = raw.length
  out.sha256 = shortHash(raw)
  return out
}

/** {redacted, len, sha256} without collapseResult's result-only `success` field. */
function stubPayload(payload: unknown): { redacted: true; len: number; sha256: string } {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? null)
  return { redacted: true, len: raw.length, sha256: shortHash(raw) }
}

/**
 * OpenAI-shaped assistant tool_call as stored on the persisted assistant row.
 */
export type AssistantToolCallForPersist = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

/**
 * Redact assistant tool_calls.arguments before durable thread JSON persist.
 * Clones; does not mutate in-flight LLM rows. Invalid JSON is replaced with a
 * stub — never stored raw (truncated streams can carry partial secrets).
 *
 * #502 B archive tier (`opts.persistFull`):
 *  - false — the DEFAULT, and deliberately fail-closed — collapses the arguments
 *    to `{redacted:true, len}`. Arguments are the second copy of the same
 *    intermediate operation the tool-result row carries (selector, fill text,
 *    evaluate code, fetched URL), so the product default drops the body here too.
 *  - true — the #255 behaviour: sensitive fields folded, the rest kept.
 *
 * `id` and `function.name` survive BOTH tiers: rebuildMessagesFromHistory pairs
 * assistant.tool_calls to tool rows by id, and the panel / audit key on the name.
 * Invalid-JSON arguments keep their own `_redacted:"invalid_json"` stub in both
 * tiers — it carries no payload and is a better diagnostic than a generic stub.
 */
export function redactAssistantToolCallsForPersistence(
  toolCalls: readonly AssistantToolCallForPersist[] | null | undefined,
  opts?: { persistFull?: boolean },
): AssistantToolCallForPersist[] {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return []
  const persistFull = opts?.persistFull === true
  return toolCalls.map((tc) => redactOneAssistantToolCall(tc, persistFull))
}

function redactOneAssistantToolCall(
  tc: AssistantToolCallForPersist,
  persistFull: boolean,
): AssistantToolCallForPersist {
  const name = typeof tc?.function?.name === "string" ? tc.function.name : ""
  const rawArgs = typeof tc?.function?.arguments === "string" ? tc.function.arguments : ""
  let argumentsOut: string
  try {
    const params = JSON.parse(rawArgs)
    if (!persistFull) {
      // Stub is derived from the raw LENGTH only — nothing sensitive can leak
      // through it, and no redaction step is needed to prove that.
      argumentsOut = JSON.stringify({ redacted: true, len: rawArgs.length })
    } else {
      const { params: safeParams } = redactToolPayloadForPersistence(name, params, null)
      argumentsOut = JSON.stringify(safeParams === undefined ? {} : safeParams)
    }
  } catch {
    argumentsOut = JSON.stringify({ _redacted: "invalid_json", len: rawArgs.length })
  }
  return {
    id: tc.id,
    type: tc.type ?? "function",
    function: {
      name,
      arguments: argumentsOut,
    },
  }
}
