/**
 * P2 ARCH-01 + bounded god-file slice: Companion-side one-shot LLM for
 * extension surfaces (NotebookLM name suggest, etc.). Keys stay in companion
 * config — never read extension chrome.storage plaintext api_key.
 */
import { getConfig, isMaskedApiKey } from "../config"
import { llmExtract } from "./llm-extract"

export type LlmOneshotRequest = {
  id?: string | null
  system_prompt?: string
  user_content?: string
}

export type LlmOneshotResult = {
  type: "llm.oneshot_result"
  id: string | null
  ok: boolean
  text?: string
  error?: string
}

export async function handleLlmOneshot(rest: LlmOneshotRequest): Promise<LlmOneshotResult> {
  const reqId = typeof rest.id === "string" ? rest.id : null
  try {
    const config = getConfig()
    const key = config.llm?.api_key
    if (!key || isMaskedApiKey(key)) {
      return {
        type: "llm.oneshot_result",
        id: reqId,
        ok: false,
        error: "companion_llm_not_configured",
      }
    }
    const systemPrompt =
      typeof rest.system_prompt === "string" ? rest.system_prompt : "You are a helpful assistant."
    const userContent = typeof rest.user_content === "string" ? rest.user_content : ""
    if (!userContent.trim()) {
      return { type: "llm.oneshot_result", id: reqId, ok: false, error: "user_content required" }
    }
    const text = await llmExtract({
      systemPrompt,
      userContent,
      config: {
        base_url: config.llm.base_url,
        api_key: key,
        model_name: config.llm.model_name,
        temperature: config.llm.temperature ?? 0.3,
        protocol: config.llm.protocol,
        auth_style: config.llm.auth_style,
        client_header_profile: config.llm.client_header_profile,
        claude_code_compat_version: config.llm.claude_code_compat_version,
        extra_headers: config.llm.extra_headers,
        anthropic_version: config.llm.anthropic_version,
        context_window: config.llm.context_window,
      },
      temperatureCap: 0.3,
      timeout: 15_000,
    })
    return { type: "llm.oneshot_result", id: reqId, ok: true, text: text || "" }
  } catch (e: any) {
    return {
      type: "llm.oneshot_result",
      id: reqId,
      ok: false,
      error: e?.message || String(e),
    }
  }
}
