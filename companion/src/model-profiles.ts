import { isDeepStrictEqual } from "node:util"
import type { LlmConfig } from "./config"

export interface TextModelProfile {
  id: string
  name: string
  /** Empty api_key means the existing runtime environment fallback. */
  llm: LlmConfig
}

export interface ModelCenterConfig {
  profiles: TextModelProfile[]
  chat_profile_id: string | null
  meeting_minutes_profile_id: string | null
  /** Absent in older configurations. An explicit configured_vision binding reuses the vision service. */
  meeting_visual_profile_id?: string | null
}

const MODEL_FIELDS = [
  "base_url", "model_name", "temperature", "context_window", "max_tokens", "reasoning_effort",
  "protocol", "auth_style", "client_header_profile", "claude_code_compat_version", "extra_headers", "anthropic_version",
] as const
const MODEL_IDENTITY_FIELDS = [
  "base_url", "model_name", "protocol", "auth_style", "client_header_profile", "claude_code_compat_version", "extra_headers", "anthropic_version",
] as const

function textModelFields(llm: LlmConfig, storedKey: string): LlmConfig {
  const entries = MODEL_FIELDS.filter(field => llm[field] !== undefined).map(field => [field, llm[field]])
  return { ...Object.fromEntries(entries), api_key: storedKey } as LlmConfig
}

export function snapshotTextModel(llm: LlmConfig, storedKey: string): LlmConfig {
  return structuredClone(textModelFields(llm, storedKey))
}

export function matchesTextModel(current: LlmConfig, storedKey: string, profile: TextModelProfile): boolean {
  return storedKey === profile.llm.api_key && MODEL_IDENTITY_FIELDS.every(field => isDeepStrictEqual(current[field], profile.llm[field]))
}
