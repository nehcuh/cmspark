// Notebook name suggester (v1.2 enhancement).
//
// When the user clicks "+ 新建 notebook" while on a content page, we extract
// the page's title + meta description + first paragraph, then call the extension's
// configured LLM (OpenAI-compatible) to suggest a concise notebook name.
// The user then edits or accepts the suggestion in the prompt dialog.
//
// Falls back to document.title (truncated) if no LLM is configured.

interface ExtensionLlmConfig {
  api_key: string
  base_url: string
  model_name: string
}

/** Read the extension-side LLM config from chrome.storage.local. */
async function getExtensionLlmConfig(): Promise<ExtensionLlmConfig | null> {
  try {
    const result = await chrome.storage.local.get(["extensionConfig", "extensionLLMConfig"])
    const cfg = result.extensionConfig as ExtensionLlmConfig | undefined
    if (cfg && cfg.api_key && cfg.base_url && cfg.model_name) return cfg
    // Legacy fallback
    const legacy = result.extensionLLMConfig as Partial<ExtensionLlmConfig> | undefined
    if (legacy && legacy.api_key && legacy.base_url && legacy.model_name) {
      return { api_key: legacy.api_key, base_url: legacy.base_url, model_name: legacy.model_name }
    }
    return null
  } catch {
    return null
  }
}

/** Extract a brief content sample from the current tab for LLM input. */
async function extractPageSummary(): Promise<{ title: string; description: string; firstParagraph: string; url: string } | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url?.startsWith("http")) return null
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const title = document.title || ""
        const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || ""
        const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute("content") || ""
        const description = metaDesc || ogDesc
        // First paragraph from main content
        const article = document.querySelector("article, main, [role='main']")
        const firstP = (article || document.body)?.querySelector("p, h1, h2")?.textContent?.trim().slice(0, 500) || ""
        return { title, description, firstParagraph: firstP, url: location.href }
      },
    })
    return results?.[0]?.result as any
  } catch {
    return null
  }
}

/** Suggest a notebook name based on the current page. Falls back to document.title
 *  if no LLM is configured or the call fails. */
export async function suggestNotebookName(): Promise<{ ok: boolean; name?: string; source: "llm" | "title" | "none"; error?: string }> {
  const summary = await extractPageSummary()
  if (!summary) {
    return { ok: false, source: "none", error: "无法读取当前 tab 内容（需要 http(s) 页面）" }
  }

  const cfg = await getExtensionLlmConfig()
  if (!cfg) {
    // Fallback: use document.title truncated
    const fallback = (summary.title || "Untitled").slice(0, 50) || "Untitled"
    return { ok: true, name: fallback, source: "title" }
  }

  // Compose prompt — ask for a concise Chinese name (since UI is Chinese)
  const userContent = `Page title: ${summary.title}
URL: ${summary.url}
Description: ${summary.description}
First paragraph: ${summary.firstParagraph}

Based on this page content, suggest a SHORT and DESCRIPTIVE notebook name (under 30 characters, Chinese if the page is in Chinese, English otherwise). Reply with ONLY the name, no quotes, no explanation, no prefix.`

  try {
    // OpenAI-compatible chat completions. Kimi review catch: add a 10s timeout so
    // the prompt dialog doesn't hang forever if the LLM endpoint is slow/unresponsive.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    // OpenAI-compatible chat completions
    const baseUrl = cfg.base_url.replace(/\/$/, "")
    const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`
    let resp: Response
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cfg.api_key}`,
        },
        body: JSON.stringify({
          model: cfg.model_name,
          messages: [
            { role: "system", content: "You are a helpful assistant that generates concise, descriptive names for NotebookLM notebooks based on web page content. Always reply with just the name, nothing else." },
            { role: "user", content: userContent },
          ],
          temperature: 0.3,
          max_tokens: 50,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!resp.ok) {
      const fallback = (summary.title || "Untitled").slice(0, 50)
      return { ok: true, name: fallback, source: "title", error: `LLM HTTP ${resp.status}` }
    }
    const data = await resp.json()
    const raw = data?.choices?.[0]?.message?.content || ""
    // Strip quotes, newlines, trailing punctuation
    const cleaned = raw.trim().replace(/^["'""]+|["'""]+$/g, "").replace(/\n+/g, " ").slice(0, 60)
    if (!cleaned) {
      const fallback = (summary.title || "Untitled").slice(0, 50)
      return { ok: true, name: fallback, source: "title" }
    }
    return { ok: true, name: cleaned, source: "llm" }
  } catch (e: any) {
    const fallback = (summary.title || "Untitled").slice(0, 50)
    return { ok: true, name: fallback, source: "title", error: e?.message || String(e) }
  }
}
