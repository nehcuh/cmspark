import type { PageSanitizer } from "./page-sanitizer"
import { readWithProvenance, type PageReadChannel } from "./page-read-provenance"
import { pageReadExpression, type PageReadRequest, type PageReadSnapshot } from "./page-read-snapshot"

export interface PageReadDependencies {
  tab: (id: number) => Promise<{ url?: string; title?: string }>
  evaluate: (id: number, expression: string, read: PageReadRequest, channel: (value: PageReadChannel) => void) => Promise<any>
  outerHtml: (id: number, selector: string) => Promise<PageReadSnapshot>
  sanitizer: Pick<PageSanitizer, "sanitize" | "sanitizeText">
}

export async function readPageText(tabId: number, deps: PageReadDependencies) {
  const result = await readWithProvenance(tabId, { kind: "document" }, deps.tab, async () => {
    let channel: PageReadChannel = "cdp"
    const request: PageReadRequest = { kind: "text" }
    const response = await deps.evaluate(tabId, pageReadExpression(request), request, value => { channel = value })
    const content = response.result?.value?.content
    if (typeof content !== "string") throw new Error("PAGE_READ_INVALID_RESULT")
    return { content, rawUrl: response.result.value.url, channel, truncated: false, limit: null, codeComparison: response.result.value.codeComparison,
      comparisonRefusal: ["UNSUPPORTED_VIEW", "IDENTITY_MISMATCH", "FILES_NOT_LOADED", "INVENTORY_MISMATCH", "HUNK_INCOMPLETE", "CAPACITY", "TARGET_CHANGED"].includes(response.result.value.comparisonRefusal) ? response.result.value.comparisonRefusal : undefined }
  })
  const sanitized = deps.sanitizer.sanitizeText(result.payload.content)
  // Apply the same text policy to nested code/identity data; never let a sidecar
  // bypass sanitization because it is outside body.text. Ordinary text stays intact.
  let comparisonRefusal = result.payload.comparisonRefusal
  let codeComparison: unknown
  if (result.payload.codeComparison !== undefined && sanitized.threatsRemoved.length === 0) {
    try {
      const encoded = JSON.stringify(result.payload.codeComparison)
      const checked = deps.sanitizer.sanitizeText(encoded)
      if (checked.threatsRemoved.length === 0 && checked.sanitized === encoded) codeComparison = result.payload.codeComparison
      else comparisonRefusal = "SOURCE_TRANSFORMED"
    } catch { /* malformed nested data cannot become capture evidence */ }
  }
  return {
    success: true,
    data: { text: sanitized.sanitized, threats_removed: sanitized.threatsRemoved, provenance: result.provenance,
      ...(codeComparison !== undefined ? { codeComparison } : {}),
      ...(comparisonRefusal ? { comparison_refusal: comparisonRefusal } : {}) },
  }
}

export async function readPageHtml(tabId: number, selector: string | undefined, deps: PageReadDependencies) {
  const actualSelector = selector || "html"
  const scope = selector ? { kind: "selector" as const, selector } : { kind: "document" as const }
  const result = await readWithProvenance(tabId, scope, deps.tab, async () => {
    let channel: PageReadChannel = "cdp"
    let snapshot: PageReadSnapshot
    const request: PageReadRequest = { kind: "html", selector: actualSelector }
    try {
      const response = await deps.evaluate(tabId,
        pageReadExpression(request), request, value => { channel = value })
      if (typeof response.result?.value?.content !== "string") throw new Error("PAGE_READ_INVALID_RESULT")
      snapshot = response.result.value
    } catch (error) {
      try { snapshot = await deps.outerHtml(tabId, actualSelector); channel = "dom" }
      catch (domError) { throw new Error(`${(error as Error).message}; DOM fallback failed: ${(domError as Error).message}`) }
    }
    if (typeof snapshot.content !== "string") throw new Error("PAGE_READ_INVALID_RESULT")
    return { content: snapshot.content, rawUrl: snapshot.url, channel, truncated: snapshot.content.length >= 500000, limit: 500000,
      releaseRelation: snapshot.releaseRelation, releaseRefusal: snapshot.releaseRefusal }
  })
  const sanitized = deps.sanitizer.sanitize(result.payload.content)
  let releaseRelation: unknown
  if (result.payload.releaseRelation !== undefined && sanitized.threatsRemoved.length === 0 && sanitized.sanitized === result.payload.content) {
    try {
      const encoded = JSON.stringify(result.payload.releaseRelation), checked = deps.sanitizer.sanitizeText(encoded)
      if (checked.threatsRemoved.length === 0 && checked.sanitized === encoded) releaseRelation = result.payload.releaseRelation
    } catch { /* malformed nested data stays ordinary HTML */ }
  }
  return {
    success: true,
    data: {
      html: sanitized.sanitized, truncated: result.payload.truncated, length: sanitized.sanitized.length,
      // Legacy execution family; actual channel is additive provenance.channel.
      source: result.payload.channel === "dom" ? "dom" : "runtime",
      threats_removed: sanitized.threatsRemoved, provenance: result.provenance,
      ...(releaseRelation !== undefined ? { releaseRelation } : {}),
      ...(["UNSUPPORTED_RELEASE_VIEW", "RELEASE_IDENTITY_MISMATCH", "RELEASE_TARGET_CHANGED", "RELEASE_CAPACITY"].includes(result.payload.releaseRefusal || "") ? { release_refusal: result.payload.releaseRefusal } : {}),
    },
  }
}
