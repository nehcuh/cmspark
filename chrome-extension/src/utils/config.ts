// Configuration constants and helpers

export const COMPANION_PORT = 23401
export const COMPANION_HOST = "127.0.0.1"
export const COMPANION_WS_URL = `ws://${COMPANION_HOST}:${COMPANION_PORT}`

export const DEFAULT_LLM_CONFIG = {
  base_url: "https://api.deepseek.com/v1",
  api_key: "",
  model_name: "deepseek-v4-pro",
  temperature: 0.7,
  context_window: 128000,
}

export function getCompanionUrl(): string {
  return COMPANION_WS_URL
}
