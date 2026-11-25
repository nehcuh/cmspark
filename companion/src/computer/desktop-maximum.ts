import { randomUUID } from "node:crypto"
import { getConfig, type CompanionConfig, type LlmConfig } from "../config"
import { isValidSecurityArmPhrase } from "../security-arm"
import { logger } from "../logger"
import { assertCoordinateAllowed } from "./policy"
import { UNATTENDED_HARD_TTL_MS, isUnattendedArmed } from "./unattended-grant"

function applicationIdentity(cfg: CompanionConfig, token: string): string | undefined {
  try {
    const app = assertCoordinateAllowed(cfg, token)
    if (app.binary_drift) return
    return JSON.stringify([app.token, app.display_name, app.added_at, app.bundleId, app.aumid, app.exe])
  } catch { return }
}

function receiver(cfg: CompanionConfig) {
  if (!cfg.vision?.enabled || cfg.vision.reuse_main_model === false) return null
  try {
    const url = new URL(cfg.llm.base_url)
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    return { model: cfg.llm.model_name, endpoint: url.href }
  } catch { return null }
}

// Keep credential-bearing route identity private. Only the display projection crosses the socket.
function routeIdentity(m: LlmConfig) {
  return JSON.stringify([m.model_name, m.base_url, m.protocol ?? "openai", m.api_key, m.auth_style,
    m.client_header_profile, m.extra_headers, m.claude_code_compat_version, m.anthropic_version])
}

function snapshot(cfg: CompanionConfig) {
  const apps = Object.keys(cfg.apps?.entries ?? {}).sort().flatMap(token => {
    const identity = applicationIdentity(cfg, token)
    return identity ? [{ token, name: cfg.apps!.entries[token].display_name, identity }] : []
  })
  return { apps, receiver: receiver(cfg), route: routeIdentity(cfg.llm) }
}

type Offer = ReturnType<typeof snapshot> & { id: string; until: number }
const offers = new WeakMap<object, Offer>()
type Grant = { peer: object; offer: Offer; images: boolean; expiresAt: number; stop: AbortController; timer: NodeJS.Timeout }
let active: Grant | undefined

export function revokeDesktopMaximum(peer?: object): boolean {
  if (peer) offers.delete(peer)
  if (!active || (peer && active.peer !== peer)) return false
  const grant = active
  active = undefined
  clearTimeout(grant.timer)
  grant.stop.abort()
  logger.info("computer.maximum.revoked", {})
  return true
}

function live() {
  if (active && active.expiresAt <= Date.now()) revokeDesktopMaximum()
  return active
}

export function desktopMaximumStatus(peer: object) {
  const grant = live()
  return { type: "computer.maximum.status", expiresAt: grant?.peer === peer ? grant.expiresAt : null }
}

export function reviewDesktopMaximum(peer: object, cfg = getConfig()) {
  const offer = { ...snapshot(cfg), id: randomUUID(), until: Date.now() + 300000 }
  offers.set(peer, offer)
  return { type: "computer.maximum.reviewed", review_id: offer.id, apps: offer.apps.map(({ token, name }) => ({ token, name })),
    receiver: offer.receiver }
}

export function armDesktopMaximum(peer: object, input: Record<string, unknown>, cfg = getConfig()) {
  const offer = offers.get(peer)
  offers.delete(peer)
  const now = Date.now()
  if (!offer || input.review_id !== offer.id || offer.until <= now || !isValidSecurityArmPhrase(input.confirmation_phrase) ||
      typeof input.images !== "boolean" || !offer.apps.length || (input.images && !offer.receiver) ||
      isUnattendedArmed() || live()) return { type: "computer.maximum.error", error: "授权未生效，请先解除已有桌面值守，再重新查看并确认范围。" }
  const current = snapshot(cfg)
  if (JSON.stringify(offer.apps) !== JSON.stringify(current.apps) ||
      (input.images && (!current.receiver || current.route !== offer.route))) {
    return { type: "computer.maximum.error", error: "应用或主模型配置已变更，请重新查看授权范围。" }
  }
  const timer = setTimeout(() => revokeDesktopMaximum(peer), UNATTENDED_HARD_TTL_MS)
  timer.unref()
  active = { peer, offer, images: input.images, expiresAt: now + UNATTENDED_HARD_TTL_MS, stop: new AbortController(), timer }
  logger.info("computer.maximum.armed", { app_count: offer.apps.length, images: input.images, expires_at: active.expiresAt })
  return desktopMaximumStatus(peer)
}

export function hasDesktopMaximum() { return !!live() }

export interface DesktopMaximumPermit {
  current(): boolean
  allowsModel(model: LlmConfig): boolean
  signal: AbortSignal
}

export function desktopMaximumPermit(peer: object, token: string, ownerCurrent: () => boolean,
  configuration = getConfig): DesktopMaximumPermit | undefined {
  const grant = live()
  if (grant?.peer !== peer) return
  const app = grant.offer.apps.find(item => item.token === token)
  if (!app) return
  const current = () => live() === grant && ownerCurrent() && applicationIdentity(configuration(), token) === app.identity
  if (!current()) return
  return { current, signal: grant.stop.signal, allowsModel(model) {
    const cfg = configuration()
    return current() && grant.images && !!receiver(cfg) && routeIdentity(cfg.llm) === grant.offer.route &&
      routeIdentity(model) === grant.offer.route
  } }
}
