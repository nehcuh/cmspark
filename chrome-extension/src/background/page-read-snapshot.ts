export type PageReadRequest = { kind: "text" } | { kind: "html"; selector: string }
export interface PageReadSnapshot { content: string; url?: string }

/** Serialized directly into CDP / chrome.scripting. Keep this function
 * self-contained: content and location are sampled in one synchronous task. */
export function pageReadSnapshot(request: PageReadRequest): PageReadSnapshot {
  const content = request.kind === "text" ? document.body?.innerText || ""
    : document.querySelector(request.selector)?.outerHTML?.substring(0, 500000) || ""
  return { content, url: location.href }
}

export function pageReadExpression(request: PageReadRequest): string {
  return `(${pageReadSnapshot.toString()})(${JSON.stringify(request)})`
}
