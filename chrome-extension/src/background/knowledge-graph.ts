// Knowledge graph tab lifecycle + session snapshot (spec #296).
// Mirrors chrome-extension/src/background/thread-graph.ts open pattern.

import type { KnowledgeGraphPayload } from "../knowledge-graph/wire"

/** Plasmo builds `src/tabs/knowledge-graph.tsx` → `tabs/knowledge-graph.html`. */
export const KNOWLEDGE_GRAPH_PATH = "tabs/knowledge-graph.html"

export const KNOWLEDGE_GRAPH_SNAPSHOT_KEY = "cmspark.knowledge_graph_snapshot"

export type KnowledgeGraphSnapshot = KnowledgeGraphPayload & {
  ts: number
  focus_id?: string | null
  llm_labels?: boolean
}

export function knowledgeGraphUrl(focusId?: string | null): string {
  const base = chrome.runtime.getURL(KNOWLEDGE_GRAPH_PATH)
  if (focusId) return `${base}?focus=${encodeURIComponent(focusId)}`
  return base
}

export function isKnowledgeGraphTabUrl(tabUrl: string | undefined, baseUrl: string): boolean {
  if (!tabUrl) return false
  try {
    const u = new URL(tabUrl)
    const b = new URL(baseUrl)
    return u.origin === b.origin && u.pathname.endsWith("/tabs/knowledge-graph.html")
  } catch {
    return (
      tabUrl.startsWith("chrome-extension://") &&
      tabUrl.includes("tabs/knowledge-graph.html")
    )
  }
}

export async function writeKnowledgeGraphSnapshot(
  payload: KnowledgeGraphPayload,
  extra?: { focus_id?: string | null; llm_labels?: boolean },
): Promise<KnowledgeGraphSnapshot> {
  const snap: KnowledgeGraphSnapshot = {
    ...payload,
    ts: Date.now(),
    focus_id: extra?.focus_id ?? null,
    llm_labels: extra?.llm_labels === true,
  }
  await chrome.storage.session.set({ [KNOWLEDGE_GRAPH_SNAPSHOT_KEY]: snap })
  return snap
}

export async function readKnowledgeGraphSnapshot(): Promise<KnowledgeGraphSnapshot | null> {
  const res = await chrome.storage.session.get(KNOWLEDGE_GRAPH_SNAPSHOT_KEY)
  const snap = res[KNOWLEDGE_GRAPH_SNAPSHOT_KEY] as KnowledgeGraphSnapshot | undefined
  if (!snap || typeof snap.status !== "string") return null
  return snap
}

/**
 * #356: knowledge.graph 的 error 帧 → error 态快照的**防御性兜底**。
 * 诚实边界（Wave7 复审 MAJOR-1）：扩展 WS 的 surface 恒为 "panel"
 * （handshake-surface.ts 对 chrome-extension origin 强制），panel-only 门
 * 对扩展流量不可达；getKnowledgeGraph 内部全 try/catch 返回 null，handler
 * 几乎不 throw，且 throw 文本是原始 message（不含动词）。故本映射在生产
 * 中预期**极少命中**——#356 的「无限重建中」根因实为 split-brain 污染
 * （knowledgeIndexPath 已改 live getConfigDir）+ too_few 无空态，由另两处
 * 修复收口；本映射只在 error 帧文本带动词时 fail-safe 生效，miss 退回既有
 * 100s 轮询上限（NIT-5）。error 帧无请求关联 id，文本动词是唯一可用 seam。
 */
export function knowledgeGraphErrorPayload(msg: unknown): KnowledgeGraphPayload | null {
  if (!msg || typeof msg !== "object") return null
  const m = msg as { type?: unknown; error?: unknown }
  if (m.type !== "error" || typeof m.error !== "string") return null
  if (!m.error.includes("knowledge.graph")) return null
  return { status: "error", truncated: false, nodes: [], edges: [], labels: {}, error: m.error }
}

/** Open or focus the graph tab (bump ts query so re-open remounts). */
export async function openOrFocusKnowledgeGraph(focusId?: string | null): Promise<number | null> {
  const baseUrl = knowledgeGraphUrl(focusId)
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}t=${Date.now()}`
  const base = chrome.runtime.getURL(KNOWLEDGE_GRAPH_PATH)
  const tabs = await chrome.tabs.query({})
  const existing = tabs.find((t) => isKnowledgeGraphTabUrl(t.url, base))
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
