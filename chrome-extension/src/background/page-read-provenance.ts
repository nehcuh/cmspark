import { browserSiteTarget } from "./browser-site-target"

export type PageReadChannel = "cdp" | "isolated" | "main" | "dom"
export type PageReadScope = { kind: "document" } | { kind: "selector"; selector: string }
export interface PageReadPayload {
  content: string
  channel: PageReadChannel
  truncated: boolean
  limit: number | null
  /** Browser-internal only, sampled together with the content. */
  rawUrl?: string
}

function redactTitleUrls(title: string): string {
  // Titles are untrusted page text. Redact URL-shaped reflections as well as
  // target.url; arbitrary non-URL secrets remain under page-content policy.
  return title.replace(/https?:\/\/[^\s<>"']+/gi, value => {
    try { const url = new URL(value); return url.origin + url.pathname } catch { return "[URL omitted]" }
  })
}

/** Capture metadata at the browser boundary, without forwarding URL secrets.
 * This describes one top-frame read, never business-wide completeness. */
export async function readWithProvenance(
  tabId: number,
  scope: PageReadScope,
  getTab: (id: number) => Promise<{ url?: string; title?: string }>,
  read: () => Promise<PageReadPayload>,
) {
  const inspect = async () => {
    try {
      const tab = await getTab(tabId)
      return { target: await browserSiteTarget(tabId, tab.url), title: tab.title?.slice(0, 1024) || "" }
    } catch { return { target: undefined, title: "" } }
  }
  const before = await inspect()
  const payload = await read()
  const after = await inspect()
  const observedTarget = await browserSiteTarget(tabId, payload.rawUrl)
  const available = Boolean(before.target && after.target && observedTarget)
  const changed = available && (
    before.target!.tab_id !== after.target!.tab_id ||
    before.target!.origin !== after.target!.origin ||
    before.target!.navigation_key !== after.target!.navigation_key ||
    observedTarget!.origin !== before.target!.origin ||
    observedTarget!.navigation_key !== before.target!.navigation_key
  )
  return {
    payload: { content: payload.content, channel: payload.channel, truncated: payload.truncated, limit: payload.limit },
    provenance: {
      schema_version: 1 as const,
      target: available && !changed ? before.target : undefined,
      title: available && !changed ? redactTitleUrls(before.title) : "",
      captured_at: new Date().toISOString(),
      channel: payload.channel,
      scope,
      frame: "top" as const,
      coverage: payload.truncated ? "partial" as const : "unknown" as const,
      complete_for_scope: false,
      pagination: "unknown" as const,
      virtualization: "unknown" as const,
      iframe_coverage: "not_traversed" as const,
      truncated: payload.truncated,
      limit: payload.limit,
      stop_reason: payload.truncated ? "CONTENT_LIMIT" : "SINGLE_READ",
      capture_status: !available ? "TARGET_UNAVAILABLE" : changed ? "TARGET_CHANGED" : "eligible",
    },
  }
}
