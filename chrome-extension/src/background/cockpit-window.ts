// Background-owned Cockpit lifecycle. #723 idle collapse is observation-only;
// closing a window never aborts or approves a computer task.
export const COCKPIT_PATH = "tabs/cockpit.html"
export const COCKPIT_DEFAULT_WIDTH = 720
export const COCKPIT_DEFAULT_HEIGHT = 560
export const COCKPIT_SESSION_KEY = "cmspark.cockpitWindowId"

type Owner = { id: number | null }
let owner: Owner = { id: null }
let operation = {}
let idleIntent = {}
let onRemovedHooked = false
let openInFlight: { promise: Promise<Owner | null>; callers: Set<() => boolean>; op: object } | null = null
let hydrateInFlight: Promise<void> | null = null
let removing: { owner: Owner; promise: Promise<void> } | null = null
let persistence: Promise<void> = Promise.resolve()

export function getCockpitWindowId(): number | null { return owner.id }
export function cockpitUrl(): string { return chrome.runtime.getURL(COCKPIT_PATH) }
export function isCockpitTabUrl(tabUrl: string | undefined, expectedBase: string): boolean {
  if (!tabUrl) return false
  try {
    const a = new URL(tabUrl), b = new URL(expectedBase)
    // URL.origin is "null" for extension URLs in some JS implementations.
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname
  } catch { return false }
}
function ownedPopup(w: chrome.windows.Window | undefined, id?: number): w is chrome.windows.Window & { id: number } {
  return !!w && Number.isSafeInteger(w.id) && w.id! >= 0 && (id === undefined || w.id === id) && w.type === "popup" &&
    w.tabs?.length === 1 && isCockpitTabUrl(w.tabs[0].url, cockpitUrl()) &&
    (!w.tabs[0].pendingUrl || isCockpitTabUrl(w.tabs[0].pendingUrl, cockpitUrl()))
}
function persistWindowId(id: number | null): void {
  // Completion may be late; it never mutates owner. Later writes remain ordered.
  persistence = persistence.then(async () => {
    if (id === null) await chrome.storage.session.remove(COCKPIT_SESSION_KEY)
    else await chrome.storage.session.set({ [COCKPIT_SESSION_KEY]: id })
  }).catch(() => {})
}
function adopt(id: number | null): Owner { owner = { id }; persistWindowId(id); return owner }
function ensureOnRemoved(): void {
  if (onRemovedHooked) return
  onRemovedHooked = true
  chrome.windows.onRemoved.addListener(id => {
    if (owner.id === id) adopt(null)
  })
}
async function getOwned(id: number): Promise<chrome.windows.Window | undefined> {
  try { const w = await chrome.windows.get(id, { populate: true }); return ownedPopup(w, id) ? w : undefined } catch { return undefined }
}
export async function reclaimCockpitWindowId(): Promise<number | null> {
  try {
    const all = (await chrome.windows.getAll({ populate: true })).filter(w => ownedPopup(w))
    return all.length === 1 ? all[0].id! : null
  } catch { return null }
}
async function hydrateCockpitWindowId(): Promise<void> {
  let expected = owner
  if (expected.id !== null) {
    const found = await getOwned(expected.id)
    if (owner !== expected || removing) return
    if (found) return
    expected = adopt(null)
  }
  let stored: unknown
  try { stored = (await chrome.storage.session.get(COCKPIT_SESSION_KEY))?.[COCKPIT_SESSION_KEY] } catch { return }
  if (owner !== expected || removing) return
  if (typeof stored === "number" && Number.isSafeInteger(stored) && stored >= 0) {
    const found = await getOwned(stored)
    if (owner !== expected || removing) return
    if (found) { adopt(stored); return }
  }
  const reclaimed = await reclaimCockpitWindowId()
  if (owner !== expected || removing) return
  if (reclaimed !== null) adopt(reclaimed)
  else persistWindowId(null)
}
function ensureHydrated(): Promise<void> {
  if (!hydrateInFlight) {
    const p = hydrateCockpitWindowId().finally(() => { if (hydrateInFlight === p) hydrateInFlight = null })
    hydrateInFlight = p
  }
  return hydrateInFlight
}
async function openImpl(allowed: () => boolean, op: object): Promise<Owner | null> {
  const current = () => operation === op && allowed() && !removing
  await ensureHydrated()
  if (!current()) return null
  const held = owner
  if (held.id !== null) {
    const found = await getOwned(held.id)
    if (owner !== held || !current()) return null
    if (found) {
      try { await chrome.windows.update(held.id, { focused: true, drawAttention: true }); return owner === held && current() ? held : null }
      catch { if (owner === held && current()) adopt(null); else return null }
    } else adopt(null)
  }
  if (!current()) return null
  const empty = owner
  try {
    const created = await chrome.windows.create({ url: cockpitUrl(), type: "popup", width: COCKPIT_DEFAULT_WIDTH, height: COCKPIT_DEFAULT_HEIGHT, focused: true })
    // A stale create cannot overwrite the new owner or delete an unknown window.
    if (owner !== empty || !current() || !created || !Number.isSafeInteger(created.id)) return null
    return adopt(created.id!)
  } catch { return null }
}
/** Coalesced existing open policy; a removal must retire before its replacement. */
export async function openOrFocusCockpit(allowed: () => boolean = () => true): Promise<number | null> {
  idleIntent = {}
  ensureOnRemoved()
  if (!allowed()) return null
  let flight = openInFlight
  if (!flight || flight.op !== operation) {
    // A current request never joins a retired operation. Claim its successor
    // before waiting, so a later explicit close can still invalidate it.
    const predecessor = flight
    const removal = removing?.promise
    const callers = new Set([allowed])
    const op = {}; operation = op
    const anyLive = () => [...callers].some(current => current())
    const p: Promise<Owner | null> = (async () => {
      if (predecessor) await predecessor.promise
      if (removal) await removal
      if (operation !== op || !anyLive()) return null
      return openImpl(anyLive, op)
    })().finally(() => { if (openInFlight?.promise === p) openInFlight = null })
    flight = { promise: p, callers, op }; openInFlight = flight
  } else flight.callers.add(allowed)
  const result = await flight.promise
  // One shared window, but each caller still needs its own live intent/owner.
  return result !== null && allowed() && owner === result && operation === flight.op && !removing ? result.id : null
}
export async function focusCockpit(): Promise<boolean> {
  idleIntent = {}; const op = operation
  if (removing) await removing.promise
  await ensureHydrated(); const held = owner
  if (operation !== op || removing || held.id === null) return false
  const found = await getOwned(held.id)
  if (!found || owner !== held || operation !== op || removing) return false
  try { await chrome.windows.update(held.id, { focused: true, drawAttention: true }); return owner === held && operation === op }
  catch { if (owner === held && operation === op) adopt(null); return false }
}
function removeOwned(held: Owner): Promise<void> {
  if (held.id === null || owner !== held || removing) return Promise.resolve()
  // Install ownership before Chrome may deliver onRemoved; no storage await here.
  let settle!: () => void
  const promise = new Promise<void>(resolve => settle = resolve)
  const claim = { owner: held, promise }; removing = claim
  let result: Promise<void>
  try { result = chrome.windows.remove(held.id) } catch { result = Promise.reject() }
  void result.then(() => { if (owner === held) adopt(null) }, () => { /* Unknown removal: retain/revalidate original owner. */ })
    .finally(() => { if (removing === claim) removing = null; settle() })
  return promise
}
export async function closeCockpit(): Promise<void> {
  idleIntent = {}; const op = {}; operation = op
  if (removing) { await removing.promise; return }
  await ensureHydrated(); const held = owner
  if (held.id === null || removing || operation !== op) return
  const found = await getOwned(held.id)
  if (found && owner === held && !removing && operation === op) await removeOwned(held)
}
export type CockpitIdleReceipt = { state: "IDLE" | "BUSY" | "UNKNOWN"; isCurrent(): boolean }
/** No idle receipt is cached or used to change confirmation/task state. */
export async function collapseCockpitIfIdle(localIdle: () => boolean, request: () => Promise<CockpitIdleReceipt>): Promise<void> {
  const intent = {}; idleIntent = intent
  const eligible = () => idleIntent === intent && localIdle() && !openInFlight && !removing
  if (!eligible()) return
  ensureOnRemoved(); await ensureHydrated()
  if (!eligible()) return
  const held = owner
  if (held.id === null) return
  const receipt = await request()
  if (!eligible() || owner !== held || receipt.state !== "IDLE" || !receipt.isCurrent()) return
  const found = await getOwned(held.id)
  if (!found || !eligible() || owner !== held || !receipt.isCurrent()) return
  // Same JS turn: final mirror/connection/reference fence then irreversible API.
  await removeOwned(held)
}
export function cockpitStatus(): { open: boolean; windowId: number | null } { return { open: owner.id !== null, windowId: owner.id } }
/** Live document correlation for the native identity experiment; no HWND claim. */
export async function claimCockpitNativeDocument(sender: chrome.runtime.MessageSender): Promise<{
  windowId: number; documentId: string; isCurrent(): boolean; revalidate(): Promise<boolean>
} | null> {
  // Chrome can connect the new document before windows.create resolves and
  // openImpl adopts its ID. Join only that already-running creation; no retry.
  const opening = openInFlight
  if (opening) {
    try { await opening.promise } catch { return null }
  }
  const held = owner
  const documentId = sender.documentId
  const tabId = sender.tab?.id
  if (held.id === null || removing || sender.id !== chrome.runtime.id || typeof documentId !== "string" ||
    !/^[\x21-\x7e]{1,128}$/.test(documentId) || !Number.isSafeInteger(tabId) ||
    sender.tab?.windowId !== held.id || !isCockpitTabUrl(sender.url, cockpitUrl())) return null
  let active = true
  const isCurrent = () => active && owner === held && !removing && held.id !== null
  const revalidate = async () => {
    if (!isCurrent()) return false
    try {
      const window = await getOwned(held.id!)
      if (!isCurrent() || window?.tabs?.[0]?.id !== tabId) { active = false; return false }
      const contexts = await chrome.runtime.getContexts({ documentIds: [documentId] })
      const valid = contexts.length === 1 && contexts[0].documentId === documentId && contexts[0].tabId === tabId &&
        contexts[0].windowId === held.id && isCockpitTabUrl(contexts[0].documentUrl, cockpitUrl())
      if (!valid) active = false
      return valid && isCurrent()
    } catch { active = false; return false }
  }
  return await revalidate() ? { windowId: held.id, documentId, isCurrent, revalidate } : null
}
export function _resetCockpitWindowStateForTests(): void {
  owner = { id: null }; operation = {}; idleIntent = {}; openInFlight = null; hydrateInFlight = null; removing = null; persistence = Promise.resolve(); onRemovedHooked = false
}
