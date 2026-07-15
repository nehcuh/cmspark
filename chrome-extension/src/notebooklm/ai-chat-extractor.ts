// AI chat extractor (Phase A / v1.2).
//
// Detects Claude / ChatGPT / Gemini conversation pages and extracts Q&A pairs
// as a single Markdown text blob suitable for NotebookLM's "Copied text" import.
//
// The runner is injected via chrome.scripting.executeScript — MUST be self-contained.

export type AiChatPlatform = "claude" | "chatgpt" | "gemini" | "unknown"

/** Detect which AI chat platform the current page is on. */
export function detectAiChatPlatform(): AiChatPlatform {
  const host = location.hostname
  const path = location.pathname
  if (host.endsWith("claude.ai") || host.endsWith("anthropic.com")) return "claude"
  if (host.endsWith("chatgpt.com") || host.endsWith("chat.openai.com")) return "chatgpt"
  if (host.endsWith("gemini.google.com")) return "gemini"
  // Fallback: check for known DOM markers
  if (document.querySelector('[data-testid*="conversation-turn"]')) return "chatgpt"
  if (document.querySelector('[class*="conversation-turn-"]')) return "claude"
  if (document.querySelector('div[role="user-message"], model-response')) return "gemini"
  void path
  return "unknown"
}

/** Self-contained runner: extract current conversation as Markdown Q&A.
 *
 *  args: [platformDetect] — unused; the runner self-detects.
 *  Returns: { ok, text, error? } */
export function extractAiChatRunner(): Promise<{ ok: boolean; text?: string; platform?: string; error?: string }> {
  type LocalPlatform = "claude" | "chatgpt" | "gemini" | "unknown"

  function detect(): LocalPlatform {
    const host = location.hostname
    if (host.endsWith("claude.ai") || host.endsWith("anthropic.com")) return "claude"
    if (host.endsWith("chatgpt.com") || host.endsWith("chat.openai.com")) return "chatgpt"
    if (host.endsWith("gemini.google.com")) return "gemini"
    if (document.querySelector('[data-testid*="conversation-turn"]')) return "chatgpt"
    if (document.querySelector('[class*="conversation-turn-"]')) return "claude"
    if (document.querySelector('model-response, user-query')) return "gemini"
    return "unknown"
  }

  function visibleText(el: Element): string {
    // cloneNode + strip scripts/style, then textContent
    const clone = el.cloneNode(true) as Element
    clone.querySelectorAll("script,style,noscript,svg,button").forEach(e => e.remove())
    return (clone.textContent || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  }

  interface Turn {
    role: "user" | "assistant"
    text: string
  }

  function extractClaude(): Turn[] {
    // Claude's DOM has alternating "human-turn" / "assistant-turn" wrappers.
    // Recent layout: [data-testid="user-message"] and [data-testid="ai-message"]
    const turns: Turn[] = []
    const userNodes = document.querySelectorAll('[data-testid="user-message"]')
    const assistantNodes = document.querySelectorAll('[data-testid="ai-message"]')
    if (userNodes.length || assistantNodes.length) {
      // Phase 5 review fix: use compareDocumentPosition with both FOLLOWING and
      // PRECEDING branches; the prior version returned 1 when neither bit was set
      // (e.g., same element), misclassifying the sort. Also removed the O(N²)
      // indexOf() call that froze large threads.
      const all: Array<{ el: Element; role: "user" | "assistant" }> = []
      userNodes.forEach(el => all.push({ el, role: "user" }))
      assistantNodes.forEach(el => all.push({ el, role: "assistant" }))
      all.sort((a, b) => {
        if (a.el === b.el) return 0
        const pos = a.el.compareDocumentPosition(b.el)
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
        return 0
      })
      for (const t of all) {
        const text = visibleText(t.el)
        if (text) turns.push({ role: t.role, text })
      }
      return turns
    }
    // Older fallback: each "conversation-turn" alternates
    const turnsAll = document.querySelectorAll("[class*='conversation-turn']")
    let expectedRole: "user" | "assistant" = "user"
    turnsAll.forEach(el => {
      const text = visibleText(el)
      if (text) {
        turns.push({ role: expectedRole, text })
        expectedRole = expectedRole === "user" ? "assistant" : "user"
      }
    })
    return turns
  }

  function extractChatgpt(): Turn[] {
    // ChatGPT uses [data-message-author-role="user"] / ["assistant"]
    const turns: Turn[] = []
    const all = document.querySelectorAll('[data-message-author-role]')
    for (const el of Array.from(all)) {
      const role = el.getAttribute("data-message-author-role")
      if (role !== "user" && role !== "assistant") continue
      const text = visibleText(el)
      if (text) turns.push({ role, text })
    }
    if (turns.length > 0) return turns
    // Fallback: conversation-turn-2 (odd=user, even=assistant starting from 1)
    const turnEls = document.querySelectorAll('[data-testid^="conversation-turn-"]')
    let expectedRole: "user" | "assistant" = "user"
    for (const el of Array.from(turnEls)) {
      const text = visibleText(el)
      if (text) {
        turns.push({ role: expectedRole, text })
        expectedRole = expectedRole === "user" ? "assistant" : "user"
      }
    }
    return turns
  }

  function extractGemini(): Turn[] {
    // Gemini uses <user-query> / <model-response> custom elements
    const turns: Turn[] = []
    const userEls = document.querySelectorAll("user-query")
    const modelEls = document.querySelectorAll("model-response")
    const all: Array<{ el: Element; role: "user" | "assistant" }> = []
    userEls.forEach(el => all.push({ el, role: "user" }))
    modelEls.forEach(el => all.push({ el, role: "assistant" }))
    // Phase 5 review fix: same compareDocumentPosition fix as Claude
    all.sort((a, b) => {
      if (a.el === b.el) return 0
      const pos = a.el.compareDocumentPosition(b.el)
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
      return 0
    })
    for (const t of all) {
      const text = visibleText(t.el)
      if (text) turns.push({ role: t.role, text })
    }
    return turns
  }

  function formatTurns(turns: Turn[], platform: string): string {
    if (turns.length === 0) return ""
    const header = `# AI Conversation — ${platform}\nSource: ${location.href}\nExtracted: ${new Date().toISOString()}\nTurns: ${turns.length}\n\n---\n\n`
    const body = turns
      .map(t => {
        const label = t.role === "user" ? "🧑 User" : "🤖 Assistant"
        return `## ${label}\n\n${t.text}\n`
      })
      .join("\n---\n\n")
    return header + body
  }

  return (async () => {
    try {
      const platform = detect()
      let turns: Turn[] = []
      if (platform === "claude") turns = extractClaude()
      else if (platform === "chatgpt") turns = extractChatgpt()
      else if (platform === "gemini") turns = extractGemini()
      else return { ok: false, error: "Not on a recognized AI chat platform (Claude / ChatGPT / Gemini)" }

      if (turns.length === 0) return { ok: false, error: `Detected ${platform} but extracted 0 turns` }

      const text = formatTurns(turns, platform)
      return { ok: true, text, platform }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })()
}
