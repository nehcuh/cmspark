/** Per-connection method ACL keyed off handshake `surface` (S21).
 *
 * Origin stays `cmspark-tray://local`. Summoner is a second tray-origin WS
 * that must not run trust-elevation / settings / pack / MCP mutate / confirm.
 * Overlay chat.create already sees companion MCP tools; `mcp.list` is read-only
 * so the overlay can show connected servers. `mcp.add` stays denied.
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
  "mcp.list",
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
