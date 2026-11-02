import { createHash } from 'node:crypto'
import { getConfig, type VisionConfig } from '../config'
import type { ActivityConfig } from './types'
import { endpointsMatch } from '../llm/vision-reuse-inherit'

export function activityModelTarget(config: ActivityConfig): { id: string; label: string } {
  const mode = config.extraction_mode || 'ocr'
  if (mode === 'ocr') return { id: 'ocr', label: 'OCR 文本 → 主对话模型' }
  const app = getConfig()
  if (mode === 'qwen') {
    const variant = app.computer?.modelVariant || '2b'
    return { id: createHash('sha256').update(JSON.stringify([mode, variant, app.computer?.modelRootDir, app.computer?.pythonMode, app.computer?.pythonPath])).digest('hex'), label: `本机 Qwen3-VL ${variant} · 内容不离机` }
  }
  const model = mode === 'dedicated' ? config.dedicated_vision : app.vision
  // Include effective gateway auth in the binding without exposing it to the renderer.
  const inherited = mode === 'vision' && app.vision?.use_main_auth && endpointsMatch(app.llm, app.vision) &&
    (app.llm.protocol ?? 'openai') === (app.vision.protocol ?? 'openai') ? app.llm : undefined
  const configured = model as Partial<VisionConfig> | undefined
  // Match resolveVisionLlmConfig's per-field precedence; ignore unused main auth.
  const auth = {
    auth_style: inherited?.auth_style ?? configured?.auth_style,
    client_header_profile: inherited?.client_header_profile ?? configured?.client_header_profile,
    claude_code_compat_version: inherited?.claude_code_compat_version ?? configured?.claude_code_compat_version,
    extra_headers: inherited?.extra_headers ?? configured?.extra_headers,
    anthropic_version: inherited?.anthropic_version ?? configured?.anthropic_version,
  }
  const headers = auth.extra_headers === undefined ? undefined : Object.fromEntries(Object.entries(auth.extra_headers).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  const id = createHash('sha256').update(JSON.stringify([mode, model?.base_url, model?.model_name, model?.protocol, model?.api_key, auth?.auth_style, auth?.client_header_profile, auth?.claude_code_compat_version, headers, auth?.anthropic_version])).digest('hex')
  let host = '未配置端点'
  try { host = new URL(model?.base_url || '').origin } catch { /* show unconfigured */ }
  return { id, label: `${mode === 'dedicated' ? '专用图像模型' : '复用视觉配置'} · ${host} · ${model?.model_name || '未配置模型'} · ${model?.protocol || 'openai'}` }
}

export function hasActivityImageConsent(config: ActivityConfig): boolean {
  return config.extraction_mode !== undefined && config.extraction_mode !== 'ocr' &&
    config.image_ai_enabled === true && config.image_ai_consent === activityModelTarget(config).id
}

export function activityVisionConfig(config: ActivityConfig): VisionConfig {
  const model = config.extraction_mode === 'dedicated' ? config.dedicated_vision : getConfig().vision
  return {
    enabled: true, base_url: '', model_name: '', api_key: '', timeout_ms: 120_000,
    max_tokens: 4000, cache_ttl_seconds: 0, ...model, fallback: 'error',
  }
}
