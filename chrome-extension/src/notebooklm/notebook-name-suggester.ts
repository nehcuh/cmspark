// Notebook name suggester (v1.2 enhancement).
//
// P2 ARCH-01: LLM calls go through Companion (llm.oneshot) — never extension
// chrome.storage plaintext api_key + direct OpenAI fetch (A1 topology).
// Falls back to document.title when Companion LLM is unavailable.

/** Extract a brief content sample from the current tab for LLM input. */
export async function extractPageSummary(): Promise<{
  title: string
  description: string
  firstParagraph: string
  url: string
} | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url?.startsWith("http")) return null
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const title = document.title || ""
        const metaDesc =
          document.querySelector('meta[name="description"]')?.getAttribute("content") || ""
        const ogDesc =
          document.querySelector('meta[property="og:description"]')?.getAttribute("content") || ""
        const description = metaDesc || ogDesc
        const article = document.querySelector("article, main, [role='main']")
        const firstP =
          (article || document.body)?.querySelector("p, h1, h2")?.textContent?.trim().slice(0, 500) ||
          ""
        return { title, description, firstParagraph: firstP, url: location.href }
      },
    })
    return results?.[0]?.result as any
  } catch {
    return null
  }
}

/**
 * Companion one-shot LLM via SW → WS. Caller in background injects transport
 * that never reads extensionConfig.api_key.
 */
export type CompanionOneshot = (req: {
  systemPrompt: string
  userContent: string
}) => Promise<{ ok: boolean; text?: string; error?: string }>

/** Suggest a notebook name based on the current page. */
export async function suggestNotebookName(
  companionOneshot?: CompanionOneshot,
): Promise<{ ok: boolean; name?: string; source: "llm" | "title" | "none"; error?: string }> {
  const summary = await extractPageSummary()
  if (!summary) {
    return { ok: false, source: "none", error: "无法读取当前 tab 内容（需要 http(s) 页面）" }
  }

  const titleFallback = (summary.title || "Untitled").slice(0, 50) || "Untitled"

  if (!companionOneshot) {
    return { ok: true, name: titleFallback, source: "title" }
  }

  const userContent = `Page title: ${summary.title}
URL: ${summary.url}
Description: ${summary.description}
First paragraph: ${summary.firstParagraph}

Based on this page content, suggest a SHORT and DESCRIPTIVE notebook name (under 30 characters, Chinese if the page is in Chinese, English otherwise). Reply with ONLY the name, no quotes, no explanation, no prefix.`

  try {
    const r = await companionOneshot({
      systemPrompt:
        "You are a helpful assistant that generates concise, descriptive names for NotebookLM notebooks based on web page content. Always reply with just the name, nothing else.",
      userContent,
    })
    if (!r.ok || !r.text?.trim()) {
      return {
        ok: true,
        name: titleFallback,
        source: "title",
        error: r.error || "LLM empty",
      }
    }
    const cleaned = r.text
      .trim()
      .replace(/^["'""]+|["'""]+$/g, "")
      .replace(/\n+/g, " ")
      .slice(0, 60)
    if (!cleaned) {
      return { ok: true, name: titleFallback, source: "title" }
    }
    return { ok: true, name: cleaned, source: "llm" }
  } catch (e: any) {
    return {
      ok: true,
      name: titleFallback,
      source: "title",
      error: e?.message || String(e),
    }
  }
}
