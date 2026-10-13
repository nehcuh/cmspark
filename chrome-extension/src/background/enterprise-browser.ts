/** Dedicated-profile browser actuator. Authority is inserted by Companion, not
 * by page scripts. No MAIN-world eval, credential values or arbitrary scripts. */
type Scope = { origin: string; path: string }
type Marker = { selector: string; text?: string }
type Rule = { selector: string; tool: "click" | "type"; effect: string; target: { tag: string; attributes: Record<string, string>; text?: string }; max_length?: number }
type Frame = { id: number; document_id: string; url: string }
export type EnterpriseSnapshot = { tab_id: number; url: string; document_id: string; generation: number; frames: Frame[]; state: string; last_business_url?: string; business_target_unavailable?: boolean; target?: Record<string, unknown> }
type Guard = { version: number; profile_id: string; mode: string; expires_at: string; policy: { navigation: Scope[]; evidence: Scope[]; login: Scope[]; ready: Marker[]; login_markers: Marker[] }; expected?: EnterpriseSnapshot; rule?: Rule }
type Result = { success: boolean; data?: any; error?: string }
const generations = new Map<number, number>()
// Process-private owned-tab history; never exported as business evidence.
const businessTabs = new Map<number, { policyKey: string; policy: Guard["policy"]; url?: string; intent?: string; ambiguous?: boolean }>()
let observing = false
let profilePromise: Promise<string> | undefined
export async function enterpriseProfileId(): Promise<string> {
  if (!profilePromise) profilePromise = (async () => {
    const stored = await chrome.storage.local.get("enterprise_profile_id")
    if (typeof stored.enterprise_profile_id === "string" && /^[0-9a-f-]{36}$/.test(stored.enterprise_profile_id)) return stored.enterprise_profile_id
    const id = crypto.randomUUID()
    await chrome.storage.local.set({ enterprise_profile_id: id })
    return id
  })().catch(error => { profilePromise = undefined; throw error })
  return profilePromise
}
function observe(): void {
  if (observing) return
  observing = true
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (change.status === "loading" || change.url !== undefined) generations.set(id, (generations.get(id) || 0) + 1)
    const tracked = businessTabs.get(id)
    if (tracked && typeof change.url === "string" && scoped(change.url, tracked.policy.navigation)) {
      if (!scoped(change.url, tracked.policy.login)) { tracked.url = change.url; tracked.ambiguous = false }
      else if (change.url !== tracked.url) {
        if (tracked.intent) tracked.url = tracked.intent
        else { delete tracked.url; tracked.ambiguous = true }
      }
    }
  })
  chrome.tabs.onRemoved.addListener(id => { generations.set(id, (generations.get(id) || 0) + 1); businessTabs.delete(id) })
}
function scoped(raw: string, scopes: Scope[]): boolean {
  try {
    const url = new URL(raw)
    if (url.username || url.password || /\\|%|\/\.{1,2}(?:\/|$)/.test(raw.split(/[?#]/)[0])) return false
    return scopes.some(s => s.origin === url.origin && (s.path === "/" || url.pathname === s.path || url.pathname.startsWith(s.path.replace(/\/$/, "") + "/")))
  } catch { return false }
}
function trackBusinessTab(tabId: number, policy: Guard["policy"], requested?: string) {
  const policyKey = JSON.stringify(policy)
  let tracked = businessTabs.get(tabId)
  if (!tracked || tracked.policyKey !== policyKey) {
    if (!tracked && businessTabs.size >= 128) throw new Error("TAB_HISTORY_CAPACITY")
    tracked = { policyKey, policy }; businessTabs.set(tabId, tracked)
  }
  if (requested) { tracked.url = requested; tracked.intent = requested; tracked.ambiguous = false }
  return tracked
}
/** This function is serialized into Chrome's ISOLATED world. Keep it self-contained. */
function inspectDocument(policy: Guard["policy"], rule?: Rule): any {
  const url = location.href
  function inScope(scopes: Scope[]) {
    try {
      const u = new URL(url)
      if (u.username || u.password || /\\|%|\/\.{1,2}(?:\/|$)/.test(url.split(/[?#]/)[0])) return false
      return scopes.some(s => s.origin === u.origin && (s.path === "/" || u.pathname === s.path || u.pathname.startsWith(s.path.replace(/\/$/, "") + "/")))
    } catch { return false }
  }
  function match(marker: Marker) {
    const elements = Array.from(document.querySelectorAll(marker.selector))
    return elements.some(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && (marker.text === undefined || e.textContent?.trim() === marker.text))
  }
  if (!inScope([...policy.navigation, ...policy.login])) return { url, state: "blocked" }
  if (inScope(policy.login) && policy.login_markers.some(match)) return { url, state: "login_required" }
  if (!inScope(policy.navigation) || !policy.ready.some(match)) return { url, state: "unsupported" }
  let target: Record<string, unknown> | undefined
  if (rule) {
    const elements = document.querySelectorAll(rule.selector)
    if (elements.length !== 1) return { url, state: "target_mismatch" }
    const e = elements[0] as HTMLElement
    const attributes: Record<string, string | null> = {}
    for (const key of ["type", "name", "role", "aria-label", "data-action", "href"]) attributes[key] = e.getAttribute(key)
    if (Object.values(attributes).some(value => value && value.length > 512)) return { url, state: "target_mismatch" }
    const rect = e.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || (e as HTMLInputElement).disabled || e.getAttribute("aria-disabled") === "true") return { url, state: "target_mismatch" }
    if (e.tagName.toLowerCase() !== rule.target.tag || Object.entries(rule.target.attributes).some(([key, value]) => attributes[key] !== value) || (rule.target.text !== undefined && e.textContent?.trim() !== rule.target.text)) return { url, state: "target_mismatch" }
    if (rule.tool === "type" && (!(e instanceof HTMLInputElement) || !["text", "search"].includes(e.type) || /password|otp|token|secret|credential|login|user.?name/i.test([e.name, e.id, e.autocomplete].join(" ")))) return { url, state: "credential_forbidden" }
    const host = globalThis as typeof globalThis & { __cmsparkEnterpriseTargets?: WeakMap<Element, string> }
    const registry = host.__cmsparkEnterpriseTargets ||= new WeakMap<Element, string>()
    let element_token = registry.get(e)
    if (!element_token) {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      element_token = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
      registry.set(e, element_token)
    }
    target = { element_token, tag: e.tagName.toLowerCase(), attributes, ...(rule.target.text === undefined ? {} : { text: e.textContent?.trim() }) }
  }
  return { url, state: "ready", ...(target ? { target } : {}) }
}
async function snapshot(tabId: number, guard: Guard): Promise<EnterpriseSnapshot> {
  const tracked = trackBusinessTab(tabId, guard.policy)
  const before = generations.get(tabId) || 0
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "ISOLATED", func: inspectDocument, args: [guard.policy, guard.rule] })
  if (results.length > 128) throw new Error("FRAME_UNAVAILABLE")
  const top = results.find(r => r.frameId === 0)
  if (!top?.documentId || !top.result || before !== (generations.get(tabId) || 0)) throw new Error("NAVIGATION_CHANGED")
  const frames = results.map(r => {
    if (!r.documentId || !r.result || typeof r.result.url !== "string") throw new Error("FRAME_UNAVAILABLE")
    return { id: r.frameId, document_id: r.documentId, url: r.result.url }
  }).sort((a, b) => a.id - b.id)
  let state = top.result.state as string
  // v1 supports main-frame QR login. A login iframe is explicitly unsupported;
  // never call a page ready solely because its main frame matches an origin.
  if (frames.length > 1 && results.some(r => r.frameId !== 0 && r.result?.state === "login_required")) state = "LOGIN_IFRAME_UNSUPPORTED"
  if ((await chrome.tabs.query({})).some(tab => tab.openerTabId === tabId)) state = "LOGIN_POPUP_UNSUPPORTED"
  if (state === "ready") { tracked.url = top.result.url; delete tracked.intent; tracked.ambiguous = false }
  return { tab_id: tabId, url: top.result.url, ...(tracked.url ? { last_business_url: tracked.url } : {}), ...(tracked.ambiguous ? { business_target_unavailable: true } : {}), document_id: top.documentId, generation: before, frames, state, ...(top.result.target ? { target: top.result.target } : {}) }
}
function sameSnapshot(a: EnterpriseSnapshot, b: EnterpriseSnapshot): boolean { return JSON.stringify(a) === JSON.stringify(b) }
/** Serialized atomic target check and effect in a single JS tick. */
function actDocument(expected: EnterpriseSnapshot, rule: Rule | null, text: string | null, scroll: number | null, policy: Guard["policy"], expires_at: string): any {
  if (!Number.isFinite(Date.parse(expires_at)) || Date.now() >= Date.parse(expires_at)) return { error: "ENTERPRISE_DEADLINE_EXPIRED" }
  if (location.href !== expected.url) return { error: "NAVIGATION_CHANGED" }
  const visible = (marker: Marker) => Array.from(document.querySelectorAll(marker.selector)).some(e => { const rect = e.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (marker.text === undefined || e.textContent?.trim() === marker.text) })
  if (policy.login_markers.some(visible) || !policy.ready.some(visible)) return { error: "READINESS_CHANGED" }
  if (scroll !== null) { window.scrollBy(0, scroll); return { executed: true } }
  if (!rule || !expected.target) return { error: "TARGET_MISMATCH" }
  const matches = document.querySelectorAll(rule.selector)
  if (matches.length !== 1) return { error: "TARGET_MISMATCH" }
  const element = matches[0] as HTMLElement
  const attributes: Record<string, string | null> = {}
  for (const key of ["type", "name", "role", "aria-label", "data-action", "href"]) attributes[key] = element.getAttribute(key)
  if (Object.values(attributes).some(value => value && value.length > 512)) return { error: "TARGET_MISMATCH" }
  const registry = (globalThis as typeof globalThis & { __cmsparkEnterpriseTargets?: WeakMap<Element, string> }).__cmsparkEnterpriseTargets
  const actual = { element_token: registry?.get(element) || null, tag: element.tagName.toLowerCase(), attributes, ...(rule.target.text === undefined ? {} : { text: element.textContent?.trim() }) }
  const rect = element.getBoundingClientRect()
  if (JSON.stringify(actual) !== JSON.stringify(expected.target) || rect.width <= 0 || rect.height <= 0 || (element as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true") return { error: "TARGET_MISMATCH" }
  if (rule.tool === "click") { element.click(); return { executed: true } }
  if (!(element instanceof HTMLInputElement) || !["text", "search"].includes(element.type) || /password|otp|token|secret|credential|login|user.?name/i.test([element.name, element.id, element.autocomplete].join(" ")) || typeof text !== "string" || text.length > (rule.max_length || 4096)) return { error: "CREDENTIAL_FIELD_FORBIDDEN" }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(element, text)
  element.dispatchEvent(new Event("input", { bubbles: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
  return { executed: true }
}
function documentText(policy: Guard["policy"]): any {
  const url = new URL(location.href)
  const allowed = policy.evidence.some(s => s.origin === url.origin && (s.path === "/" || url.pathname === s.path || url.pathname.startsWith(s.path.replace(/\/$/, "") + "/")))
  if (!allowed || policy.login_markers.some(m => document.querySelector(m.selector))) return { omitted: true }
  return { text: (document.body?.innerText || "").slice(0, 16_384), truncated: (document.body?.innerText || "").length > 16_384 }
}
export async function executeEnterpriseBrowser(tool: string, params: Record<string, any>, capture: (params: Record<string, any>) => Promise<Result>): Promise<Result> {
  try {
    observe()
    const guard = params.__enterprise_guard as Guard
    if (!guard || guard.version !== 1 || guard.profile_id !== await enterpriseProfileId()) throw new Error("ENTERPRISE_PROFILE_MISMATCH")
    const deadline = () => { if (!Number.isFinite(Date.parse(guard.expires_at)) || Date.now() >= Date.parse(guard.expires_at)) throw new Error("ENTERPRISE_DEADLINE_EXPIRED") }
    deadline()
    if (guard.mode === "probe" && tool === "list_tabs") return { success: true, data: { enterprise_contract: 1, profile_id: guard.profile_id } }
    if (guard.mode === "open" && tool === "create_tab") {
      if (!scoped(params.url, guard.policy.navigation)) throw new Error("NAVIGATION_FORBIDDEN")
      const tab = await chrome.tabs.create({ url: params.url, active: false })
      if (!Number.isSafeInteger(tab.id)) throw new Error("TAB_UNAVAILABLE")
      trackBusinessTab(tab.id!, guard.policy, params.url)
      return { success: true, data: { tab_id: tab.id } }
    }
    if (!Number.isSafeInteger(params.tabId) || params.tabId < 0) throw new Error("TAB_UNAVAILABLE")
    const current = await snapshot(params.tabId, guard)
    if (guard.mode === "inspect" && tool === "list_tabs") return { success: true, data: current }
    if (!guard.expected || !sameSnapshot(current, guard.expected)) throw new Error("NAVIGATION_CHANGED")
    deadline()
    if (guard.mode === "navigate" && tool === "navigate") {
      if (!scoped(current.url, [...guard.policy.navigation, ...guard.policy.login]) || !scoped(params.url, guard.policy.navigation)) throw new Error("NAVIGATION_FORBIDDEN")
      await chrome.tabs.update(params.tabId, { url: params.url })
      trackBusinessTab(params.tabId, guard.policy, params.url)
      return { success: true, data: { executed: true } }
    }
    if (guard.mode === "login-screenshot" && tool === "screenshot") {
      if (current.state !== "login_required" || current.frames.some(frame => !scoped(frame.url, [...guard.policy.login, ...guard.policy.navigation]))) throw new Error("LOGIN_VIEW_FORBIDDEN")
    } else if (tool === "get_page_text" || tool === "screenshot") {
      if (current.state !== "ready" || !scoped(current.url, guard.policy.evidence)) throw new Error("EVIDENCE_FORBIDDEN")
    } else {
      if (current.state !== "ready" || !scoped(current.url, guard.policy.navigation)) throw new Error("ACTION_SCOPE_FORBIDDEN")
    }
    if ((guard.mode === "business-screenshot" || guard.mode === "login-screenshot") && tool === "screenshot") {
      if (guard.mode === "business-screenshot" && current.frames.some(frame => !scoped(frame.url, guard.policy.evidence))) throw new Error("SCREENSHOT_SCOPE_INCOMPLETE")
      const result = await capture({ tabId: params.tabId })
      const after = await snapshot(params.tabId, guard)
      deadline()
      if (!sameSnapshot(current, after)) throw new Error("NAVIGATION_CHANGED")
      if (!result.success || typeof result.data?.image_base64 !== "string") throw new Error("SCREENSHOT_UNAVAILABLE")
      // Never return URL/title; they may contain login tickets or identity.
      return { success: true, data: { image_base64: result.data.image_base64, width: result.data.width, height: result.data.height } }
    }
    if (guard.mode === "text" && tool === "get_page_text") {
      const docs = current.frames.filter(frame => scoped(frame.url, guard.policy.evidence)).map(frame => frame.document_id)
      const reads = await chrome.scripting.executeScript({ target: { tabId: params.tabId, documentIds: docs }, world: "ISOLATED", func: documentText, args: [guard.policy] })
      if (!sameSnapshot(current, await snapshot(params.tabId, guard))) throw new Error("NAVIGATION_CHANGED")
      deadline()
      return { success: true, data: { text: reads.filter(r => !r.result?.omitted).map(r => r.result?.text || "").join("\n").slice(0, 65_536), provenance: { source: "visible_dom", coverage: "incomplete", frames_read: reads.filter(r => !r.result?.omitted).length, frames_total: current.frames.length, workbook_complete: false } } }
    }
    if (guard.mode === "act" && ["click", "type", "scroll"].includes(tool)) {
      if (tool !== "scroll" && guard.rule?.tool !== tool) throw new Error("ACTION_INVALID")
      const results = await chrome.scripting.executeScript({ target: { tabId: params.tabId, documentIds: [current.document_id] }, world: "ISOLATED", func: actDocument, args: [current, guard.rule || null, params.text ?? null, tool === "scroll" ? params.delta : null, guard.policy, guard.expires_at] })
      if (results.length !== 1 || !results[0].result?.executed) throw new Error(results[0]?.result?.error || "ACTION_UNAVAILABLE")
      return { success: true, data: { executed: true } }
    }
    throw new Error("ENTERPRISE_TOOL_FORBIDDEN")
  } catch (error) {
    // Page/Chrome exceptions are untrusted, may contain tokens; fixed allowlist.
    const code = (error as Error).message
    const allowed = /^(ENTERPRISE_PROFILE_MISMATCH|ENTERPRISE_DEADLINE_EXPIRED|READINESS_CHANGED|ACTION_SCOPE_FORBIDDEN|NAVIGATION_CHANGED|NAVIGATION_FORBIDDEN|TAB_UNAVAILABLE|LOGIN_VIEW_FORBIDDEN|EVIDENCE_FORBIDDEN|SCREENSHOT_SCOPE_INCOMPLETE|SCREENSHOT_UNAVAILABLE|TARGET_MISMATCH|CREDENTIAL_FIELD_FORBIDDEN|ACTION_INVALID|ACTION_UNAVAILABLE|ENTERPRISE_TOOL_FORBIDDEN)$/
    return { success: false, error: allowed.test(code) ? code : "ENTERPRISE_BROWSER_UNAVAILABLE" }
  }
}
