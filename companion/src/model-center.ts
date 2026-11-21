import { randomUUID } from "node:crypto"
import {
  createTextModelConfig,
  getCommittedConfigRevision,
  getConfigSnapshot,
  getModelProfileRuntimeKey,
  getStoredMainModelKey,
  isMaskedApiKey,
  saveModelCenterConfig,
  type CompanionConfig,
  type LlmConfig,
} from "./config"
import { matchesTextModel, snapshotTextModel, type ModelCenterConfig, type TextModelProfile } from "./model-profiles"
import { assertLlmEndpointUrlAllowed } from "./security"

const MAX_PROFILES = 32
const PROFILE_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/

export type ModelCenterAction =
  | { kind: "save_current"; name: string }
  | { kind: "create"; name: string; provider: { protocol: "openai" | "anthropic"; base_url: string; model_name: string; api_key?: string } }
  | { kind: "rename"; profile_id: string; name: string }
  | { kind: "remove"; profile_id: string }
  | { kind: "bind"; scope: "chat" | "meeting_minutes"; profile_id: string | null }

export function isModelCenterAction(action: unknown): action is ModelCenterAction {
  if (!action || typeof action !== "object" || Array.isArray(action)) return false
  const value = action as Record<string, unknown>
  const name = typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value.name)
  const id = typeof value.profile_id === "string" && PROFILE_ID.test(value.profile_id)
  switch (value.kind) {
    case "save_current": return name
    case "create": {
      const provider = value.provider as Record<string, unknown> | undefined
      return name && !!provider && typeof provider === "object" && !Array.isArray(provider) &&
        (provider.protocol === "openai" || provider.protocol === "anthropic") &&
        typeof provider.base_url === "string" && provider.base_url.length > 0 && provider.base_url.length <= 2048 &&
        typeof provider.model_name === "string" && provider.model_name.length > 0 && provider.model_name.length <= 256 &&
        (provider.api_key === undefined || typeof provider.api_key === "string" && provider.api_key.length <= 4096)
    }
    case "rename": return id && name
    case "remove": return id
    case "bind": return (value.scope === "chat" || value.scope === "meeting_minutes") && (id || value.profile_id === null)
    default: return false
  }
}

/** Expose the address without credentials, query parameters, or a fragment. */
export function displayModelEndpoint(address: string): string {
  try {
    const url = new URL(address)
    return url.origin + url.pathname
  } catch { return "" }
}

function namedEndpointAllowed(address: string): boolean {
  if (assertLlmEndpointUrlAllowed(address)) return false
  const url = new URL(address)
  return !url.username && !url.password && !url.href.includes("?") && !url.href.includes("#")
}

function currentCenter(config: CompanionConfig): ModelCenterConfig {
  const center = config.model_center
  const profiles = Array.isArray(center?.profiles) ? center.profiles.filter(profile =>
    profile && typeof profile.name === "string" && PROFILE_ID.test(profile.id) && profile.llm &&
    typeof profile.llm.base_url === "string" && typeof profile.llm.model_name === "string" && typeof profile.llm.api_key === "string",
  ) : []
  const chat = profiles.find(profile => profile.id === center?.chat_profile_id)
  return {
    profiles,
    chat_profile_id: chat && namedEndpointAllowed(chat.llm.base_url) && matchesTextModel(config.llm, getStoredMainModelKey(), chat) ? chat.id : null,
    // Keep a broken independent binding visible to the resolver so it fails closed.
    meeting_minutes_profile_id: typeof center?.meeting_minutes_profile_id === "string" ? center.meeting_minutes_profile_id : null,
  }
}

function usableLlm(llm: LlmConfig | undefined): llm is LlmConfig {
  return typeof llm?.base_url === "string" && !!llm.base_url &&
    typeof llm.model_name === "string" && !!llm.model_name.trim() &&
    typeof llm.api_key === "string" && !!llm.api_key.trim() && !isMaskedApiKey(llm.api_key)
}

function profileLlm(profile: TextModelProfile): LlmConfig {
  return { ...profile.llm, api_key: getModelProfileRuntimeKey(profile.llm.api_key) }
}

function publicState({ config, revision }: ReturnType<typeof getConfigSnapshot>) {
  const center = currentCenter(config)
  return {
    config_revision: revision,
    model_center: {
      chat_profile_id: center.chat_profile_id,
      meeting_minutes_profile_id: center.meeting_minutes_profile_id,
      profiles: center.profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        model_name: profile.llm.model_name,
        base_url: displayModelEndpoint(profile.llm.base_url),
        has_key: !!profileLlm(profile).api_key,
      })),
    },
  }
}

export function readModelCenter() {
  return publicState(getConfigSnapshot())
}

export function resolveMeetingTextModel({ config }: ReturnType<typeof getConfigSnapshot>) {
  const center = currentCenter(config)
  const profile = center.profiles.find(item => item.id === (center.meeting_minutes_profile_id ?? center.chat_profile_id))
  let llm = config.llm
  if (center.meeting_minutes_profile_id !== null) {
    if (!profile || !namedEndpointAllowed(profile.llm.base_url)) return null
    llm = profileLlm(profile)
  }
  return usableLlm(llm) ? { llm, profileId: profile?.id ?? null, profileName: profile?.name ?? null } : null
}

export function saveModelCenter(action: ModelCenterAction, expectedRevision: string) {
  if (!isModelCenterAction(action)) throw new Error("INVALID_MODEL_CENTER_ACTION")
  const snapshot = getConfigSnapshot()
  if (snapshot.revision !== expectedRevision) throw new Error("CONFIG_REVISION_CONFLICT")
  const { config } = snapshot
  const center = currentCenter(config)
  const profile = "profile_id" in action ? center.profiles.find(item => item.id === action.profile_id) : undefined
  if ("profile_id" in action && action.profile_id !== null && !profile) throw new Error("MODEL_PROFILE_NOT_FOUND")
  let replacement: LlmConfig | undefined
  switch (action.kind) {
    case "create":
    case "save_current":
    case "rename": {
      const name = action.name.trim()
      if (center.profiles.some(item => item.id !== profile?.id && item.name.toLowerCase() === name.toLowerCase())) throw new Error("MODEL_PROFILE_NAME_IN_USE")
      if (action.kind === "rename") {
        center.profiles = center.profiles.map(item => item.id === profile?.id ? { ...item, name } : item)
        break
      }
      if (center.profiles.length >= MAX_PROFILES) throw new Error("MODEL_PROFILE_LIMIT")
      const llm = action.kind === "create" ? createTextModelConfig({
        protocol: action.provider.protocol,
        base_url: action.provider.base_url.trim(),
        model_name: action.provider.model_name.trim(),
        api_key: action.provider.api_key?.trim() ?? "",
      }) : config.llm
      if (!usableLlm(llm)) throw new Error("MODEL_NOT_CONFIGURED")
      if (!namedEndpointAllowed(llm.base_url)) throw new Error("MODEL_ENDPOINT_INVALID")
      center.profiles.push({ id: randomUUID(), name, llm: snapshotTextModel(llm, action.kind === "create" ? llm.api_key : getStoredMainModelKey()) })
      break
    }
    case "remove":
      if (center.chat_profile_id === action.profile_id || center.meeting_minutes_profile_id === action.profile_id) throw new Error("MODEL_PROFILE_IN_USE")
      center.profiles = center.profiles.filter(item => item.id !== action.profile_id)
      break
    case "bind":
      if (profile) {
        if (!usableLlm(profileLlm(profile))) throw new Error("MODEL_NOT_CONFIGURED")
        if (!namedEndpointAllowed(profile.llm.base_url)) throw new Error("MODEL_ENDPOINT_INVALID")
      }
      if (action.scope === "chat") {
        center.chat_profile_id = action.profile_id
        if (profile) {
          const { context_compaction, context_compaction_m2, native_vision, native_vision_detected } = config.llm
          replacement = { ...profile.llm, context_compaction, context_compaction_m2, native_vision }
          if (profile.llm.base_url === config.llm.base_url && profile.llm.model_name === config.llm.model_name && profile.llm.protocol === config.llm.protocol) {
            replacement.native_vision_detected = native_vision_detected
          }
        }
      } else {
        center.meeting_minutes_profile_id = action.profile_id
      }
      break
  }

  const written = saveModelCenterConfig(center, replacement, expectedRevision)
  try {
    const saved = getConfigSnapshot()
    if (saved.config !== written || getCommittedConfigRevision(written) !== saved.revision) throw new Error("CONFIG_REVISION_CONFLICT")
    return publicState(saved)
  } finally { getCommittedConfigRevision(written) }
}
