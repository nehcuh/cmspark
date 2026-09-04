// #296 LLM 分组命名开关：chrome.storage.local，默认关（spec §3.2 / AC-4）。

export const KNOWLEDGE_GRAPH_LLM_LABELS_KEY = "knowledge_graph_llm_labels"

/** Fail-closed: only an explicit true enables the opt-in. */
export function parseLlmLabelsPref(value: unknown): boolean {
  return value === true
}

export async function readLlmLabelsPref(): Promise<boolean> {
  try {
    const res = await chrome.storage.local.get(KNOWLEDGE_GRAPH_LLM_LABELS_KEY)
    return parseLlmLabelsPref(res[KNOWLEDGE_GRAPH_LLM_LABELS_KEY])
  } catch {
    return false
  }
}

export async function writeLlmLabelsPref(enabled: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [KNOWLEDGE_GRAPH_LLM_LABELS_KEY]: enabled === true })
  } catch {
    /* ignore quota / missing API */
  }
}
