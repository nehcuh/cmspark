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
 * #356/#374: 在途 knowledge.graph 请求 id 注册表（SW 发请求时登记，响应到达时注销）。
 * #374 动机：companion 对 handleMessage 响应（含门拒与 handler-throw catch）统一回带
 * `{..., id: msg?.id}`（lifecycle.ts 响应发送路径）；请求带 id 后 error 帧即可**按 id 精确
 * 关联**，替代/兜底文本动词 seam——handler-throw 的原始 message 往往不含动词，文本 seam
 * 命中不到。
 */
const inflightGraphRequestIds = new Set<string>()

export function trackGraphRequest(id: string | undefined | null): void {
  if (typeof id === "string" && id) inflightGraphRequestIds.add(id)
}

export function untrackGraphRequest(id: unknown): void {
  if (typeof id === "string") inflightGraphRequestIds.delete(id)
}

/** 断线/重连时清空——旧 socket 的在途请求不会再有响应（#290 stale guard 之外的一致性）。 */
export function clearGraphRequests(): void {
  inflightGraphRequestIds.clear()
}

export function graphRequestInFlight(id: unknown): boolean {
  return typeof id === "string" && inflightGraphRequestIds.has(id)
}

/**
 * #374: error 帧按请求 id 精确关联（优先于文本 seam）。
 * 命中：`type==="error"` 且 `id` 是某在途 knowledge.graph 请求。命中即注销该 id
 * （一次请求只有一次响应），返回 error 态载荷；error 文本可选透传。
 */
export function knowledgeGraphErrorById(msg: unknown): KnowledgeGraphPayload | null {
  if (!msg || typeof msg !== "object") return null
  const m = msg as { type?: unknown; id?: unknown; error?: unknown }
  if (m.type !== "error" || typeof m.id !== "string") return null
  if (!graphRequestInFlight(m.id)) return null
  untrackGraphRequest(m.id)
  return {
    status: "error",
    truncated: false,
    nodes: [],
    edges: [],
    labels: {},
    ...(typeof m.error === "string" && m.error ? { error: m.error } : {}),
  }
}

/**
 * #356: knowledge.graph 的 error 帧 → error 态快照的**文本兜底**（#374 之后保留为
 * 第二道 seam，专指不带 id 的 validate/ACL 早退帧——扩展正常请求不会触发，防未来回归）。
 * 诚实边界（Wave7 复审 MAJOR-1）：扩展 WS surface 恒为 "panel"，panel-only 门对扩展
 * 流量不可达；getKnowledgeGraph 内部全 try/catch 返回 null。本映射生产命中面窄，fail-safe，
 * miss 退回既有 100s 轮询上限（NIT-5）。
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
