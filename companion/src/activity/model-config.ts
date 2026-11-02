import { createHash } from 'node:crypto'
import { getConfig, type VisionConfig } from '../config'
import type { ActivityConfig } from './types'

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
  const auth = mode === 'vision' && app.vision?.use_main_auth ? app.llm : undefined
  const id = createHash('sha256').update(JSON.stringify([mode, model?.base_url, model?.model_name, model?.protocol, model?.api_key, auth?.auth_style, auth?.client_header_profile, auth?.claude_code_compat_version, auth?.extra_headers, auth?.anthropic_version])).digest('hex')
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
