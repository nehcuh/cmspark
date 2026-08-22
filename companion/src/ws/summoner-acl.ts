/** Per-connection method ACL keyed off handshake `surface` (S21).
 *
 * Origin stays `cmspark-tray://local`. Summoner is a second tray-origin WS
 * that must not run trust-elevation / settings / pack / MCP / confirm.
 * Tray (`surface !== "summoner"`, including omitted/undefined) is not gated —
 * origin-cleaving would break tray `skill.list`.
 */

const SUMMONER_ALLOW = new Set([
  "system.ping",
  "chat.create",
  "chat.abort",
  "thread.list",
  "thread.select",
  "thread.create",
  "history.query",
  "composer.lease.claim",
  "composer.lease.release",
  "composer.lease.get",
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
