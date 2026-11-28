import { createHash } from 'node:crypto'
import { modelRecipient } from '../llm/recipient'
import { getConfig, type CompanionConfig, type VisionConfig } from '../config'
import type { ActivityConfig } from './types'
import { resolveVisionLlmConfig } from '../llm/vision-config'
import { visionConfigForAnalyze } from '../llm/likely-multimodal'

export function activityModelTarget(config: ActivityConfig, snapshot?: CompanionConfig): { id: string; label: string; unavailable?: string } {
  const mode = config.extraction_mode || 'ocr'
  if (mode === 'ocr') return { id: 'ocr', label: 'OCR 文本 → 主对话模型' }
  const app = snapshot ?? getConfig()
  if (mode === 'qwen') {
    const variant = app.computer?.modelVariant || '2b'
    return { id: createHash('sha256').update(JSON.stringify([mode, variant, app.computer?.modelRootDir, app.computer?.pythonMode, app.computer?.pythonPath])).digest('hex'), label: `本机 Qwen3-VL ${variant} · 内容不离机` }
  }
  const model = activityVisionConfig(config, app)
  // Include effective gateway auth in the binding without exposing it to the renderer.
  const auth = resolveVisionLlmConfig(model, app.llm)
  const headers = auth.extra_headers === undefined ? undefined : Object.fromEntries(Object.entries(auth.extra_headers).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  const id = createHash('sha256').update(JSON.stringify([mode, model.base_url, model.model_name, model.protocol, model.api_key, auth.auth_style, auth.client_header_profile, auth.claude_code_compat_version, headers, auth.anthropic_version])).digest('hex')
  const unavailable = !model.enabled ? '请先在「看图与截图」开启截图视觉分析' :
    !model.base_url || !model.model_name ? '请先填写所选图像模型的服务地址和模型名称' : undefined
  if (unavailable) return { id, label: unavailable, unavailable }
  let host = '未配置端点'
  try { host = new URL(model.base_url).origin } catch { /* show unconfigured */ }
  return { id, label: `${mode === 'dedicated' ? '专用图像模型' : '复用视觉配置'} · ${host} · ${model.model_name} · ${model.protocol || 'openai'}` }
}

function consentMatches(config: ActivityConfig, consent: string | undefined, snapshot?: CompanionConfig): boolean {
  const target = activityModelTarget(config, snapshot)
  return !target.unavailable && consent === target.id
}

export function hasActivityTitleConsent(config: ActivityConfig, snapshot?: CompanionConfig): boolean {
  return config.title_ai_enabled === true && (config.extraction_mode === 'vision' || config.extraction_mode === 'dedicated') &&
    consentMatches(config, config.title_ai_consent, snapshot)
}

export function hasActivityImageConsent(config: ActivityConfig, snapshot?: CompanionConfig): boolean {
  return config.extraction_mode !== undefined && config.extraction_mode !== 'ocr' &&
    config.image_ai_enabled === true && consentMatches(config, config.image_ai_consent, snapshot)
}

// Persist only a fingerprint. A queued OCR job must not follow a changed main endpoint.
export function recognitionTarget(config: ActivityConfig): string {
  if ((config.extraction_mode || 'ocr') !== 'ocr') return activityModelTarget(config).id
  return modelRecipient('ocr', getConfig().llm)
}

export function activityVisionConfig(config: ActivityConfig, app = getConfig()): VisionConfig {
  const dedicated = config.extraction_mode === 'dedicated'
  const model = dedicated ? config.dedicated_vision : visionConfigForAnalyze(app.llm, app.vision)
  return {
    enabled: dedicated || !!model, base_url: '', model_name: '', api_key: '', timeout_ms: 120_000,
    max_tokens: 4000, cache_ttl_seconds: 0, ...model, ...(config.image_output_tokens ? { max_tokens: config.image_output_tokens } : {}), fallback: 'error',
  }
}
