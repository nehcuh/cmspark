// Tab resolver — finds the best matching tab for a user query
// Priority: pinned tabs → active tab → semantic match (reverse open order)

interface TabInfo {
  id: number
  url: string
  title: string
  active: boolean
  index: number
  status: string
}

/**
 * Resolve the best tab for the current operation.
 * tabList is expected to be the full list from chrome.tabs.query.
 * pinnedTabIds are the thread's pinned tab IDs.
 * userQuery is the user's message text (for semantic matching fallback).
 */
export function resolveTargetTab(
  tabList: TabInfo[],
  pinnedTabIds: number[],
  userQuery: string,
  explicitTabId?: number,
): { tabId: number; matched: "explicit" | "pinned" | "active" | "semantic"; } {
  // 1. Explicit tabId takes highest priority
  if (explicitTabId && tabList.some(t => t.id === explicitTabId)) {
    return { tabId: explicitTabId, matched: "explicit" }
  }

  // 2. Pinned tabs — use the first one that's still available
  if (pinnedTabIds.length > 0) {
    for (const id of pinnedTabIds) {
      if (tabList.some(t => t.id === id)) {
        return { tabId: id, matched: "pinned" }
      }
    }
  }

  // 3. Active tab
  const activeTab = tabList.find(t => t.active)
  if (activeTab?.id != null) {
    // Check if active tab content is relevant to the query
    if (isTabRelevant(activeTab, userQuery)) {
      return { tabId: activeTab.id, matched: "active" }
    }

    // 4. Semantic matching — search tabs in reverse open order (newest first)
    const sorted = [...tabList].sort((a, b) => b.index - a.index)
    for (const tab of sorted) {
      if (tab.id === activeTab.id) continue // already checked
      if (isTabRelevant(tab, userQuery)) {
        return { tabId: tab.id!, matched: "semantic" }
      }
    }
  }

  // 5. Fallback to active tab even if not relevant
  if (activeTab?.id != null) {
    return { tabId: activeTab.id, matched: "active" }
  }

  // 6. Last resort — first available tab
  const first = tabList[0]
  if (first?.id != null) {
    return { tabId: first.id, matched: "active" }
  }

  throw new Error("No tabs available")
}

/**
 * Simple keyword matching: extract keywords from query and check against tab title/URL.
 * Not LLM-based — fast and deterministic.
 */
function isTabRelevant(tab: TabInfo, query: string): boolean {
  if (!query || query.length < 3) return true // short query, assume relevant

  const keywords = extractKeywords(query)
  if (keywords.length === 0) return true

  const tabText = `${tab.title || ""} ${tab.url || ""}`.toLowerCase()
  const matchCount = keywords.filter(kw => tabText.includes(kw)).length

  // Consider relevant if at least 30% of keywords match
  return matchCount / keywords.length >= 0.3
}

function extractKeywords(query: string): string[] {
  // Extract meaningful words (Chinese: individual chars, English: words)
  const lower = query.toLowerCase()
  // Remove common stop words
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "for",
    "on", "and", "or", "not", "this", "that", "it", "at", "by", "from",
    "请", "帮", "我", "的", "是", "了", "在", "吗", "吧", "啊", "哦", "嗯",
    "这", "那", "一", "个", "你", "他", "她", "它", "们",
  ])

  const words = lower
    .split(/[\s,，。！？、；：""''（）\(\)\[\]{}<>\/\\|@#$%^&*+=~`\-_]+/)
    .filter(w => w.length >= 2 && !stopWords.has(w))

  // For Chinese text, also extract 2-char bigrams
  const chineseChars = lower.replace(/[^一-鿿]/g, "")
  const bigrams: string[] = []
  for (let i = 0; i < chineseChars.length - 1; i++) {
    bigrams.push(chineseChars.slice(i, i + 2))
  }

  return [...new Set([...words, ...bigrams])]
}
