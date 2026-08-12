// Thread graph tab lifecycle + session snapshot (design TG-1…TG-5).
// Spec: docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md

/** Plasmo builds `src/tabs/thread-graph.tsx` → `tabs/thread-graph.html`. */
export const THREAD_GRAPH_PATH = "tabs/thread-graph.html"

export const THREAD_GRAPH_SNAPSHOT_KEY = "cmspark.thread_graph_snapshot"

/** Slim thread seed — digest only, never message bodies (R5). */
export type ThreadGraphSlim = {
  id: string
  alias?: string
  updated_at?: string
  created_at?: string
  agent_role?: string
  trashed_at?: string | null
  digest?: {
    tldr?: string
    tags?: string[]
    bullets?: string[]
    stale?: boolean
  } | null
}

export type ThreadGraphSnapshot = {
  ts: number
  threads: ThreadGraphSlim[]
  focus_id?: string | null
}

const SNAPSHOT_TTL_MS = 5 * 60 * 1000

export function threadGraphUrl(focusId?: string | null): string {
  const base = chrome.runtime.getURL(THREAD_GRAPH_PATH)
  if (focusId) return `${base}?focus=${encodeURIComponent(focusId)}`
  return base
}

export function isThreadGraphTabUrl(tabUrl: string | undefined, baseUrl: string): boolean {
  if (!tabUrl) return false
  try {
    const u = new URL(tabUrl)
    const b = new URL(baseUrl)
    return u.origin === b.origin && u.pathname.endsWith("/tabs/thread-graph.html")
  } catch {
    return (
      tabUrl.startsWith("chrome-extension://") &&
      tabUrl.includes("tabs/thread-graph.html")
    )
  }
}

export function isSnapshotFresh(snap: ThreadGraphSnapshot | null | undefined, now = Date.now()): boolean {
  if (!snap || !Array.isArray(snap.threads)) return false
  if (typeof snap.ts !== "number") return false
  return now - snap.ts <= SNAPSHOT_TTL_MS
}

/**
 * Runtime allowlist — never trust callers to pass only slim fields.
 * Drops workspace_root / message previews / tool lists if a future writer is sloppy.
 */
export function slimThreadGraphRow(raw: unknown): ThreadGraphSlim | null {
  if (!raw || typeof raw !== "object") return null
  const t = raw as Record<string, unknown>
  const id = typeof t.id === "string" ? t.id : ""
  if (!id) return null
  let digest: ThreadGraphSlim["digest"] = null
  if (t.digest && typeof t.digest === "object") {
    const d = t.digest as Record<string, unknown>
    const tags = Array.isArray(d.tags)
      ? d.tags.filter((x): x is string => typeof x === "string").slice(0, 32)
      : undefined
    const bullets = Array.isArray(d.bullets)
      ? d.bullets.filter((x): x is string => typeof x === "string").slice(0, 12)
      : undefined
    digest = {
      tldr: typeof d.tldr === "string" ? d.tldr.slice(0, 500) : undefined,
      tags,
      bullets,
      stale: typeof d.stale === "boolean" ? d.stale : undefined,
    }
  }
  return {
    id,
    alias: typeof t.alias === "string" ? t.alias.slice(0, 200) : undefined,
    updated_at: typeof t.updated_at === "string" ? t.updated_at : undefined,
    created_at: typeof t.created_at === "string" ? t.created_at : undefined,
    agent_role: typeof t.agent_role === "string" ? t.agent_role : undefined,
    trashed_at:
      t.trashed_at === null
        ? null
        : typeof t.trashed_at === "string"
          ? t.trashed_at
          : undefined,
    digest,
  }
}

export async function prepareThreadGraphSnapshot(
  threads: ThreadGraphSlim[] | unknown[],
  focusId?: string | null,
): Promise<ThreadGraphSnapshot> {
  // Cap to recent N (design §4.2) after runtime slim
  const slimmed = (threads || [])
    .map((t) => slimThreadGraphRow(t))
    .filter((t): t is ThreadGraphSlim => t != null)
  const live = slimmed
    .filter((t) => t.id && !t.trashed_at)
    .filter((t) => t.agent_role !== "worker")
  live.sort((a, b) => {
    const ta = new Date(a.updated_at || a.created_at || 0).getTime()
    const tb = new Date(b.updated_at || b.created_at || 0).getTime()
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
  })
  let capped = live.slice(0, 300)
  // P1 M-UI-1: always pin focus into the cap set when present
  if (focusId) {
    const hasFocus = capped.some((t) => t.id === focusId)
    if (!hasFocus) {
      const focusRow = live.find((t) => t.id === focusId)
      if (focusRow) {
        capped = [focusRow, ...capped.filter((t) => t.id !== focusId)].slice(0, 300)
      }
    }
  }
  const snap: ThreadGraphSnapshot = {
    ts: Date.now(),
    threads: capped,
    focus_id: focusId || null,
  }
  await chrome.storage.session.set({ [THREAD_GRAPH_SNAPSHOT_KEY]: snap })
  return snap
}

export async function readThreadGraphSnapshot(): Promise<ThreadGraphSnapshot | null> {
  const res = await chrome.storage.session.get(THREAD_GRAPH_SNAPSHOT_KEY)
  const snap = res[THREAD_GRAPH_SNAPSHOT_KEY] as ThreadGraphSnapshot | undefined
  if (!snap || !Array.isArray(snap.threads)) return null
  return snap
}

/** Open or focus the graph tab after snapshot is prepared. */
export async function openOrFocusThreadGraph(focusId?: string | null): Promise<number | null> {
  // P1 H-UI-1: bump ts query so same-focus re-open remounts and reloads snapshot
  const baseUrl = threadGraphUrl(focusId)
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}t=${Date.now()}`
  const base = chrome.runtime.getURL(THREAD_GRAPH_PATH)
  const tabs = await chrome.tabs.query({})
  const existing = tabs.find((t) => isThreadGraphTabUrl(t.url, base))
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true, url })
    if (existing.windowId != null) {
      try {
        await chrome.windows.update(existing.windowId, { focused: true })
      } catch {
        /* ignore */
      }
    }
    return existing.id
  }
  const tab = await chrome.tabs.create({ url, active: true })
  return tab.id ?? null
}
