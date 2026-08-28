/** Per-connection method ACL keyed off handshake `surface` (S21).
 *
 * Origin stays `cmspark-tray://local`. Summoner is a second tray-origin WS
 * that must not run trust-elevation / settings / pack / MCP mutate / confirm.
 * Overlay chat.create already sees companion MCP tools; `mcp.list` is read-only
 * so the overlay can show connected servers. `mcp.add` stays denied.
 * `pack.apply` is allowed but router forces allowTrust=false + overlay-eligible.
 * `thread.delete` / `thread.update` are overlay-safe only via
 * `applySummonerPayloadPolicy` (trash-only; alias-only).
 * Tray (`surface !== "summoner"`, including omitted/undefined) is not gated —
 * origin-cleaving would break tray `skill.list`.
 */

const SUMMONER_ALLOW = new Set([
  "system.ping",
  "chat.create",
  "chat.abort",
  "chat.steer",
  "thread.list",
  "thread.select",
  "thread.create",
  "thread.delete",
  "thread.update",
  "history.query",
  "composer.lease.claim",
  "composer.lease.release",
  "composer.lease.release_overlay",
  "composer.lease.get",
  "voice.stt.start",
  "voice.stt.chunk",
  "voice.stt.end",
  "voice.stt.abort",
  "voice.stt.partial_request",
  "meeting.create",
  "meeting.start",
  "meeting.end",
  "meeting.append_transcript",
  "meeting.generate_minutes",
  "meeting.list",
  "meeting.get",
  "meeting.auto_diarize",
  "mcp.list",
  "mcp.toggle_server",
  "pack.list",
  "pack.apply",
  "skill.list",
  "skill.activate",
  "skill.deactivate",
  "knowledge.list",
  "knowledge.set_active",
  "file.upload",
  "companion.ui.rect",
])

export function assertSummonerAllowed(
  surface: string | undefined,
  type: string,
): { ok: true } | { ok: false; error_code: "SUMMONER_ACL"; error: string } {
  if (surface !== "summoner") return { ok: true }
  if (SUMMONER_ALLOW.has(type)) return { ok: true }
  return {
    ok: false,
    error_code: "SUMMONER_ACL",
    error: `SUMMONER_ACL: ${type} not allowed on summoner surface`,
  }
}

function overlayAlias(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const alias = raw.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 200)
  return alias || null
}

/**
 * Overlay-safe payload gate. Method allowlist is not enough: tray `thread.delete`
 * defaults to hard, and `thread.update` can mutate tool_whitelist / knowledge ids.
 * Mutates `msg` in place (strips non-alias updates). Tray / omitted surface: no-op.
 */
export function applySummonerPayloadPolicy(
  surface: string | undefined,
  msg: Record<string, unknown>,
): { ok: true } | { ok: false; error_code: "SUMMONER_ACL"; error: string } {
  if (surface !== "summoner") return { ok: true }
  const type = msg.type
  if (type === "thread.delete") {
    if (msg.mode !== "trash") {
      return {
        ok: false,
        error_code: "SUMMONER_ACL",
        error: "SUMMONER_ACL: thread.delete on overlay must use mode=trash",
      }
    }
    return { ok: true }
  }
  if (type === "thread.update") {
    const updates = msg.updates
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return {
        ok: false,
        error_code: "SUMMONER_ACL",
        error: "SUMMONER_ACL: thread.update overlay may only set alias",
      }
    }
    const alias = overlayAlias((updates as { alias?: unknown }).alias)
    if (!alias) {
      return {
        ok: false,
        error_code: "SUMMONER_ACL",
        error: "SUMMONER_ACL: thread.update overlay may only set alias",
      }
    }
    msg.updates = { alias }
    return { ok: true }
  }
  if (type === "knowledge.set_active") {
    const threadId = typeof msg.thread_id === "string" ? msg.thread_id.trim() : ""
    if (!threadId) {
      return {
        ok: false,
        error_code: "SUMMONER_ACL",
        error: "SUMMONER_ACL: knowledge.set_active requires thread_id",
      }
    }
    const raw = Array.isArray(msg.ids) ? msg.ids : []
    const ids = raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0).slice(0, 32)
    for (const key of Object.keys(msg)) {
      if (key !== "type" && key !== "thread_id" && key !== "ids") delete msg[key]
    }
    msg.thread_id = threadId
    msg.ids = ids
    return { ok: true }
  }
  if (type === "pack.apply") {
    delete msg.allowTrust
    delete msg.workspace_path
    delete msg.force_takeover
    delete msg.confirmation_phrase
    const packId = typeof msg.pack_id === "string" ? msg.pack_id.trim() : ""
    const threadId = typeof msg.thread_id === "string" ? msg.thread_id.trim() : ""
    if (!packId || !threadId) {
      return {
        ok: false,
        error_code: "SUMMONER_ACL",
        error: "SUMMONER_ACL: pack.apply requires pack_id and thread_id",
      }
    }
    msg.pack_id = packId
    msg.thread_id = threadId
    msg.user_gesture = true
    return { ok: true }
  }
  if (type === "meeting.start") {
    msg.audio_retained = false
    delete msg.retain_days
    return { ok: true }
  }
  return { ok: true }
}
