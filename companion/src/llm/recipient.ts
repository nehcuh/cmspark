import { createHash } from "node:crypto"
import type { LlmConfig } from "../config"

export function modelRecipient(purpose: string, model: LlmConfig): string {
  const { base_url, model_name, protocol, api_key, auth_style, client_header_profile,
    claude_code_compat_version, anthropic_version, extra_headers } = model
  const headers = Object.entries(extra_headers || {}).sort(([a], [b]) => a.localeCompare(b))
  return createHash("sha256").update(JSON.stringify([purpose, base_url, model_name, protocol, api_key,
    auth_style, client_header_profile, claude_code_compat_version, anthropic_version, headers])).digest("hex")
}
