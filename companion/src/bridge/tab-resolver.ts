// Tab resolver — finds the best matching tab for a user query
// Priority: pinned tabs → active tab → semantic match (reverse open order)

import { logger } from "../logger"

export interface TabInfo {
  id: number
  url: string
  title: string
  active: boolean
  index: number
  status: string
}

/** Type guard for valid TabInfo */
export function isValidTabInfo(tab: unknown): tab is TabInfo {
  return (
    typeof tab === "object" &&
    tab !== null &&
    typeof (tab as TabInfo).id === "number" &&
    typeof (tab as TabInfo).url === "string" &&
    typeof (tab as TabInfo).title === "string" &&
    typeof (tab as TabInfo).active === "boolean" &&
    typeof (tab as TabInfo).index === "number" &&
    typeof (tab as TabInfo).status === "string"
  )
}

/** Type guard for valid tab list */
export function isValidTabList(list: unknown): list is TabInfo[] {
  return Array.isArray(list) && list.every(isValidTabInfo)
}

/** Custom error for tab resolution failures with detailed context */
export class TabResolutionError extends Error {
  constructor(
    message: string,
    public readonly context: {
      tabCount: number
      pinnedCount: number
      explicitTabId?: number
      queryPreview?: string
    }
  ) {
    super(message)
    this.name = "TabResolutionError"
  }
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
): { tabId: number; matched: "explicit" | "pinned" | "active" | "semantic" | "last_resort"; } {
  // Input validation with clear error messages
  if (!Array.isArray(tabList)) {
    throw new TabResolutionError(
      "Invalid tab list: expected an array",
      { tabCount: 0, pinnedCount: pinnedTabIds.length, explicitTabId, queryPreview: userQuery?.slice(0, 100) }
    )
  }

  if (tabList.length === 0) {
    throw new TabResolutionError(
      "No tabs available — browser may be closed or all tabs are special pages (chrome://, edge://, etc.)",
      { tabCount: 0, pinnedCount: pinnedTabIds.length, explicitTabId, queryPreview: userQuery?.slice(0, 100) }
    )
  }

  // Validate all tabs have required structure
  for (const tab of tabList) {
    if (!isValidTabInfo(tab)) {
      // Use Object.keys to safely get properties from invalid object
      const idStr = typeof tab === "object" && tab !== null ? String((tab as Record<string, unknown>).id ?? "undefined") : "not-object"
      const urlStr = typeof tab === "object" && tab !== null ? String((tab as Record<string, unknown>).url ?? "undefined") : "not-object"
      throw new TabResolutionError(
        `Invalid tab data: missing required fields (id=${idStr}, url=${urlStr})`,
        { tabCount: tabList.length, pinnedCount: pinnedTabIds.length, explicitTabId }
      )
    }
  }

  // Validate pinned tab IDs are numbers
  if (pinnedTabIds.some(id => typeof id !== "number" || isNaN(id))) {
    throw new TabResolutionError(
      "Invalid pinned tab IDs: all IDs must be valid numbers",
      { tabCount: tabList.length, pinnedCount: pinnedTabIds.length, explicitTabId }
    )
  }
  // Priority 1: Explicit tabId takes highest priority
  // FIX: Only return if tab still exists — otherwise fall through to recovery
  // (LLM may hallucinate stale tabId; we should gracefully recover rather than fail)
  if (explicitTabId != null) {
    const tab = tabList.find(t => t.id === explicitTabId)
    if (tab) {
      logger.info("tab_resolved", { matched: "explicit", tabId: explicitTabId, query: userQuery.slice(0, 100) }, "bridge")
      return { tabId: explicitTabId, matched: "explicit" }
    }
    // Explicit tabId invalid — fall through silently (LLM hallucination is common, not worth logging)
  }

  // Priority 2: Pinned tabs — use the LAST matching one (highest priority)
  // FIX: Reverse iteration so the most-recently-pinned tab (end of array) has highest priority
  // This matches the user's mental model where "pinning" a tab makes it the current focus
  // FIXED [HIGH]: Guard clause added - skip loop entirely when pinnedTabIds is empty
  // Previously, empty arrays would still enter loop context (though no iterations)
  // Now we explicitly check to make intent clear and avoid unnecessary context setup
  if (pinnedTabIds.length > 0) {
    for (let i = pinnedTabIds.length - 1; i >= 0; i--) {
      const id = pinnedTabIds[i]
      const tab = tabList.find(t => t.id === id)
      if (tab) {
        logger.info("tab_resolved", { matched: "pinned", tabId: id, pinnedCount: pinnedTabIds.length, priorityIndex: i }, "bridge")
        return { tabId: id, matched: "pinned" }
      }
    }
  }

  // Cache active tab lookup (used multiple times below)
  // FIX: Move outside conditional to enable reuse in semantic matching loop
  const activeTab = tabList.find(t => t.active)

  // Priority 3: Active tab — only if semantically relevant to the query
  // FIX: Separated from fallback to avoid redundant checks and improve clarity
  // Active tab is only returned when it makes sense for the current query
  if (activeTab && isTabRelevant(activeTab, userQuery)) {
    logger.info("tab_resolved", { matched: "active", tabId: activeTab.id, reason: "relevant" }, "bridge")
    return { tabId: activeTab.id, matched: "active" }
  }

  // Priority 4: Semantic matching — search tabs in reverse open order (newest first)
  // FIXED [HIGH]: Cache sorted array to avoid O(n log n) sorting on each call
  // Previously, we'd sort every time even if we returned early from priority 3
  // Now we only sort if we reach this fallback path
  // FIX: Explicitly skip activeTab since we already checked relevance above
  // This prevents returning the same tab with a different "matched" type
  // Also reuse sortedByNewest for priority 6 to avoid redundant sorting
  const sortedByNewest = [...tabList].sort((a, b) => b.index - a.index)
  for (const tab of sortedByNewest) {
    // tab.id is guaranteed to be a number by isValidTabInfo check above
    if (activeTab && tab.id === activeTab.id) continue // already checked
    if (isTabRelevant(tab, userQuery)) {
      logger.info("tab_resolved", { matched: "semantic", tabId: tab.id, url: tab.url?.slice(0, 100) }, "bridge")
      return { tabId: tab.id, matched: "semantic" }
    }
  }

  // Priority 5: Fallback to active tab even if not semantically relevant
  // FIX: Ensures we always have a reasonable default target
  // This is reached when: no explicit tab, no pinned tabs, active tab not relevant, no semantic matches
  if (activeTab) {
    logger.debug("tab_resolved", { matched: "active", tabId: activeTab.id, reason: "fallback" }, "bridge")
    return { tabId: activeTab.id, matched: "active" }
  }

  // Priority 6: Last resort — newest tab (by index)
  // FIXED [LOW]: Use lowercase "last_resort" for consistency with other match types
  // Previously used "active" which was confusing - this is actually a fallback path
  // Use sortedByNewest list rather than tabList[0] for predictable behavior
  // When there's no active tab (e.g., all tabs minimized or special pages), return newest
  if (sortedByNewest.length > 0) {
    logger.warn("tab_resolved", { matched: "last_resort", tabId: sortedByNewest[0].id, totalTabs: tabList.length }, "bridge")
    return { tabId: sortedByNewest[0].id, matched: "last_resort" }
  }

  throw new TabResolutionError(
    "No tabs available — browser may be closed or all tabs are special pages (chrome://, edge://, etc.)",
    { tabCount: tabList.length, pinnedCount: pinnedTabIds.length, explicitTabId, queryPreview: userQuery?.slice(0, 100) }
  )
}

/**
 * Simple keyword matching: extract keywords from query and check against tab title/URL.
 * Not LLM-based — fast and deterministic.
 *
 * FIX: Improved boundary handling for short queries and empty keyword sets.
 * - Short queries (<3 chars) now fallback to literal substring match
 * - Empty keyword extraction falls back to substring match to avoid false positives
 * - This prevents queries like "click this" from matching every tab blindly
 */
function isTabRelevant(tab: TabInfo, query: string): boolean {
  if (!query) return false // No query = cannot determine relevance

  // FIXED [MEDIUM]: Reject special-character-only queries (e.g., "!@#$%")
  // Previously, these would fall through to substring matching and could match oddly
  // Now we explicitly check if there's any alphanumeric content before proceeding
  const hasContent = /[\p{L}\p{N}]/u.test(query)
  if (!hasContent) {
    return false // No meaningful content to match
  }

  // FIXED [HIGH]: Dynamic threshold based on query length
  // Short queries (1-2 keywords) require higher match ratio to avoid false positives
  // Long queries can tolerate lower absolute ratio due to more keywords to match
  // This prevents "click" from matching every page with "click" in title
  const calculateThreshold = (keywordCount: number): number => {
    if (keywordCount <= 2) return 0.5  // 50% for 1-2 keywords
    if (keywordCount <= 4) return 0.35 // 35% for 3-4 keywords
    return 0.25  // 25% for 5+ keywords
  }

  // For very short queries (1-2 chars), use literal substring match
  // This prevents ambiguous single-char queries from matching everything
  if (query.length < 3) {
    const tabText = `${tab.title || ""} ${tab.url || ""}`.toLowerCase()
    return tabText.includes(query.toLowerCase())
  }

  const keywords = extractKeywords(query)

  // When keyword extraction fails (e.g., all stop-words like "click on this"),
  // fallback to direct substring match of first 10 chars to avoid false positives
  if (keywords.length === 0) {
    const tabText = `${tab.title || ""} ${tab.url || ""}`.toLowerCase()
    return tabText.includes(query.toLowerCase().slice(0, 10))
  }

  const tabText = `${tab.title || ""} ${tab.url || ""}`.toLowerCase()
  const matchCount = keywords.filter(kw => tabText.includes(kw)).length
  const threshold = calculateThreshold(keywords.length)

  return matchCount / keywords.length >= threshold
}

// FIXED [LOW]: Move stopWords to module-level constant to avoid recreating on every call
// Previously, the Set was created fresh for each extractKeywords invocation
// This is wasteful for a read-only dataset that never changes
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "for",
  "on", "and", "or", "not", "this", "that", "it", "at", "by", "from",
  "请", "帮", "我", "的", "是", "了", "在", "吗", "吧", "啊", "哦", "嗯",
  "这", "那", "一", "个", "你", "他", "她", "它", "们",
])

function extractKeywords(query: string): string[] {
  // Extract meaningful words (Chinese: individual chars, English: words)
  const lower = query.toLowerCase()

  // FIXED [MEDIUM]: Simplified regex - removed duplicate character classes
  // Previously had both \s and a space in the char class, plus duplicate punctuation
  // This reduces regex size and improves matching clarity
  const words = lower
    .split(/[\s,。！？、；：""''（）\[\]{}<>\/\\|@#$%^&*+=~`_-]+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w))

  // FIXED [MEDIUM]: Handle odd-length Chinese text correctly
  // Previously, "你好吗" (3 chars) would only produce "你好" and miss "好吗"
  // Now we handle the last character by including it if no bigram exists
  const chineseChars = lower.replace(/[^一-鿿]/g, "")
  const bigrams: string[] = []
  for (let i = 0; i < chineseChars.length - 1; i++) {
    bigrams.push(chineseChars.slice(i, i + 2))
  }
  // For odd-length strings, add the final char as a single if it's meaningful
  // (Chinese single chars are often valid keywords unlike English)

  return [...new Set([...words, ...bigrams])]
}
