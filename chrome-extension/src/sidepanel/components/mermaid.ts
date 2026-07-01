// Mermaid rendering for committed (non-streaming) markdown messages.
//
// Security (decision C1 — defense-in-depth):
//   1. mermaid is initialized with securityLevel:"strict", which disables
//      foreignObject / HTML labels → output is pure SVG shapes + <text>.
//   2. We then run OUR DOMPurify over the SVG output a second time using the
//      curated SVG profile (USE_PROFILES svg + svgFilters) before injecting.
//   The side panel is a privileged extension page (cookies/tabs/debugger/
//   <all_urls>), so SVG produced from untrusted (LLM / prompt-injected) input
//   must never bypass sanitization — an SVG XSS here = full extension takeover.
//
// Streaming (decision A): mermaid renders ONLY in committed MessageRow output,
// never in the live StreamingMarkdown bubble (half-built diagrams are unreadable
// and re-rendering per token would flicker/error). This util is therefore called
// only from MarkdownRenderer when renderMermaid=true.

import DOMPurify from "dompurify"

type Mermaid = typeof import("mermaid").default

let mermaidPromise: Promise<Mermaid> | null = null

/**
 * Lazy-load + initialize mermaid exactly once. Idempotent — concurrent callers
 * share the same promise. The dynamic import is code-split by Parcel into lazy
 * chunks fetched from the extension origin (CSP-safe, verified by spike).
 */
export function ensureMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(mod => {
      const mermaid = mod.default
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict", // disables click interactions; sanitizes labels
        theme: "default", // light — matches #fff / #f5f7fa bubble palette
        // Render labels as <text>/<tspan>, NOT <foreignObject>. REQUIRED because
        // our DOMPurify SVG profile (decision C1) strips foreignObject — with
        // the default htmlLabels:true, node labels vanish and only <text> edge
        // labels survive (the "some text present, some missing" bug). This keeps
        // the output pure-SVG, matching what C1's sanitization assumes.
        htmlLabels: false,
      })
      return mermaid
    })
  }
  return mermaidPromise
}

/**
 * Background prefetch — kick off the mermaid import without awaiting, so the
 * first real diagram doesn't stall on the chunk load. Called on side-panel idle
 * and when an assistant message starts streaming. Once-flag is implicit via
 * mermaidPromise. Errors are swallowed here; real failures surface at render.
 */
export function prefetchMermaid(): void {
  void ensureMermaid().catch(() => {
    /* ignore — surfaced at render time if it actually matters */
  })
}

/** Open a full-size copy of the SVG in a new tab (decision F3 — click-to-expand). */
function openSvgInNewTab(svg: string): void {
  try {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
    // chrome.tabs.create is the idiomatic opener in an extension page; fall back
    // to window.open if the API is unavailable. Blob: top-level nav is allowed
    // by Chrome (unlike data: URLs, which Chrome blocks at top level).
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url })
    } else {
      window.open(url, "_blank", "noopener,noreferrer")
    }
    // Give the new tab time to load before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  } catch {
    /* expand is a nicety — never fatal */
  }
}

/** Remove stray temp elements mermaid may leave after a failed render. */
function cleanupMermaidTemps(id: string): void {
  for (const stray of [id, `d${id}`]) {
    document.getElementById(stray)?.remove()
  }
}

let renderSeq = 0

/**
 * Find every `language-mermaid` code block under `root` and replace it with a
 * rendered, sanitized, responsive SVG. Resilient to React re-injection:
 * React owns the container's innerHTML (via dangerouslySetInnerHTML); our swaps
 * are ephemeral and get wiped on the next content change, after which the
 * caller's effect re-invokes this. Stale-node guard: skip nodes that detached
 * before the async render resolves.
 */
export async function renderMermaidBlocks(root: HTMLElement): Promise<void> {
  const codes = Array.from(root.querySelectorAll<HTMLElement>("code.language-mermaid"))
  if (codes.length === 0) return
  const mermaid = await ensureMermaid()

  for (const code of codes) {
    const pre = code.parentElement
    // Skip if detached (React wiped it) or already claimed by a render pass
    // (done | pending | error). Claiming "pending" synchronously below, before
    // the await, prevents duplicate concurrent renders of the same block when
    // html changes rapidly — the done/error markers are only set post-await.
    if (!pre || !pre.isConnected || pre.dataset.mermaidRendered) continue
    pre.dataset.mermaidRendered = "pending"

    const graphDef = code.textContent ?? ""
    const id = `mmd-${renderSeq++}`

    try {
      const { svg } = await mermaid.render(id, graphDef)
      if (!pre.isConnected) {
        cleanupMermaidTemps(id)
        continue
      }
      // Defense-in-depth: second DOMPurify pass over mermaid's SVG output.
      const clean = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      })

      const wrap = document.createElement("div")
      wrap.className = "mermaid-wrap"
      wrap.innerHTML = clean
      const svgEl = wrap.querySelector("svg")
      if (svgEl) {
        svgEl.classList.add("mermaid-svg")
        // preventDefault so any <a> mermaid embedded in the SVG can't navigate
        // the panel — a click anywhere on the diagram uniformly means "expand".
        svgEl.addEventListener("click", (e) => {
          e.preventDefault()
          openSvgInNewTab(clean)
        })
      }

      pre.dataset.mermaidRendered = "done"
      pre.replaceWith(wrap)
    } catch {
      // Fallback: leave the raw mermaid source visible as a code block + tag
      // an error label so the user sees something went wrong (not a blank gap).
      if (pre.isConnected) {
        pre.dataset.mermaidRendered = "error"
        if (!pre.querySelector(".mermaid-error")) {
          const err = document.createElement("div")
          err.className = "mermaid-error"
          err.textContent = "⚠️ 图表语法错误，显示源码"
          pre.insertBefore(err, pre.firstChild)
        }
      }
      cleanupMermaidTemps(id)
    }
  }
}
