import { createHash } from 'node:crypto'
import { decodePngToRgba } from '../computer/png-decode'
import { encodePngRgba } from '../llm/image-preview'
import { ActivityError, isActivityAppId, type ActivityChatProfile, type ActivityConfig, type ActivityRect } from './types'
import { validatePng } from './image'

/** An expected refusal: no source or model request may follow it. */
export class ActivityScopeSkip extends ActivityError {
  constructor(public status: 'scope_uncalibrated' | 'scope_layout_changed' | 'scope_title_mismatch' | 'scope_unreadable', message: string) {
    super('CHAT_SCOPE_SKIPPED', message)
  }
}
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
function keys(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  if (!plain(value) || Object.keys(value).some(key => !names.includes(key))) throw new ActivityError('INVALID_REQUEST', '聊天范围结构无效')
}
export function imageSize(image: Buffer): { width: number; height: number } {
  validatePng(image)
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
}
export function validateActivityRect(value: unknown, width = 8192, height = 8192): asserts value is ActivityRect {
  keys(value, ['x', 'y', 'width', 'height'])
  const { x, y, width: w, height: h } = value
  if (![x, y, w, h].every(Number.isSafeInteger) || Number(x) < 0 || Number(y) < 0 || Number(w) <= 0 || Number(h) <= 0 || Number(x) + Number(w) > width || Number(y) + Number(h) > height) throw new ActivityError('INVALID_REQUEST', '聊天区域必须是截图内的有效整数像素矩形')
}
export const containsRect = (outer: ActivityRect, inner: ActivityRect): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
export const chatProfileKey = (profile: Pick<ActivityChatProfile, 'window_class' | 'width' | 'height'>): string => JSON.stringify([profile.window_class, profile.width, profile.height])
export function validateChatScopes(value: unknown): void {
  if (!Array.isArray(value) || value.length > 20) throw new ActivityError('INVALID_REQUEST', '最多限定 20 个聊天应用')
  const apps = new Set<string>()
  for (const scope of value) {
    keys(scope, ['app_id', 'profiles'])
    if (!isActivityAppId(scope.app_id) || apps.has(scope.app_id) || !Array.isArray(scope.profiles) || scope.profiles.length > 8) throw new ActivityError('INVALID_REQUEST', '聊天应用范围无效或重复')
    apps.add(scope.app_id)
    const layouts = new Set<string>()
    for (const profile of scope.profiles) {
      keys(profile, ['window_class', 'width', 'height', 'content', 'title', 'allowed_titles'])
      if (typeof profile.window_class !== 'string' || !profile.window_class.trim() || profile.window_class.length > 256 || !Number.isSafeInteger(profile.width) || !Number.isSafeInteger(profile.height) || Number(profile.width) < 1 || Number(profile.height) < 1 || Number(profile.width) > 8192 || Number(profile.height) > 8192 || Number(profile.width) * Number(profile.height) > 16_777_216) throw new ActivityError('INVALID_REQUEST', '聊天窗口布局无效')
      validateActivityRect(profile.content, Number(profile.width), Number(profile.height)); validateActivityRect(profile.title, Number(profile.width), Number(profile.height))
      if (!containsRect(profile.content, profile.title) || !Array.isArray(profile.allowed_titles) || profile.allowed_titles.length < 1 || profile.allowed_titles.length > 20 || profile.allowed_titles.some(title => typeof title !== 'string' || !title.trim() || title.length > 200 || title !== title.trim())) throw new ActivityError('INVALID_REQUEST', '标题区域须位于聊天内容内，并填写完整允许标题')
      const key = chatProfileKey(profile as unknown as ActivityChatProfile)
      if (layouts.has(key)) throw new ActivityError('INVALID_REQUEST', '相同窗口布局只能保留一份校准，请明确替换旧范围')
      layouts.add(key)
    }
  }
}
export function profileForFrame(config: ActivityConfig, appId: string, windowClass: string | undefined, image: Buffer): ActivityChatProfile | undefined {
  const scopes = config.chat_scopes?.filter(scope => scope.app_id === appId) || []
  if (!scopes.length) return undefined
  if (scopes.length !== 1 || !scopes[0].profiles.length) throw new ActivityScopeSkip('scope_uncalibrated', '此应用已限定对话，但尚未校准聊天区域；请先完成校准')
  const size = imageSize(image)
  const profiles = scopes[0].profiles.filter(profile => profile.window_class === windowClass && profile.width === size.width && profile.height === size.height)
  if (profiles.length !== 1) throw new ActivityScopeSkip('scope_layout_changed', '当前聊天窗口布局或尺寸尚未校准；请重新设置聊天区域')
  return profiles[0]
}
/** Preview and live capture share the exact same OCR projection. */
export function recognizedChatTitle(result: unknown): string {
  const value = result as { ok?: boolean; words?: Array<{ text?: unknown }> }
  if (value?.ok !== true || !Array.isArray(value.words) || value.words.some(word => !word || typeof word.text !== 'string')) throw new ActivityError('OCR_FAILED', '本机 OCR 未返回可靠标题')
  const title = value.words.map(word => word.text as string).join(' ').trim()
  if (title.length > 200) throw new ActivityScopeSkip('scope_unreadable', '标题区域包含过多文字；请只框选当前聊天标题')
  return title
}

/** Quartz and X11 receipts give a window title. Treat a change as an uncalibrated layout. */
export function namedWindowLayout(platform: 'darwin' | 'linux', title: unknown): string | undefined {
  if (typeof title !== 'string' || !title.trim() || title.length >= 500) return undefined
  return platform + ':' + createHash('sha256').update(title).digest('hex')
}

/** Both crops are made from the same locally decoded frame, with no rescaling. */
export function activityImageCrop(image: Buffer): (rect: ActivityRect) => Buffer {
  const size = imageSize(image)
  const { rgba, width, height } = decodePngToRgba(image)
  if (size.width !== width || size.height !== height) throw new ActivityError('INVALID_IMAGE', '截图尺寸不一致')
  return rect => {
    validateActivityRect(rect, width, height)
    const rowBytes = rect.width * 4
    const crop = new Uint8Array(rowBytes * rect.height)
    for (let row = 0; row < rect.height; row++) {
      const offset = ((rect.y + row) * width + rect.x) * 4
      crop.set(rgba.subarray(offset, offset + rowBytes), row * rowBytes)
    }
    const png = encodePngRgba(crop, rect.width, rect.height)
    validatePng(png)
    return png
  }
}

export async function scopeLocalFrame(config: ActivityConfig, appId: string, windowClass: string | undefined, image: Buffer,
  signal: AbortSignal, readTitle: (crop: Buffer) => Promise<string>): Promise<{ image: Buffer; conversation_title?: string }> {
  const profile = profileForFrame(config, appId, windowClass, image)
  if (!profile) return { image }
  let crop: ReturnType<typeof activityImageCrop>, title: string
  try {
    crop = activityImageCrop(image)
    title = await readTitle(crop(profile.title))
    signal.throwIfAborted()
  } catch (error) {
    if (signal.aborted) throw error
    throw new ActivityScopeSkip('scope_unreadable', '当前聊天标题无法在本机识别；请核对 OCR 语言与标题区域')
  }
  if (!title) throw new ActivityScopeSkip('scope_unreadable', '未能识别当前聊天标题；请核对标题区域与本机 OCR 语言')
  if (!profile.allowed_titles.includes(title)) throw new ActivityScopeSkip('scope_title_mismatch', '当前聊天标题不在允许名单，已跳过且未保存截图')
  return { image: crop(profile.content), conversation_title: title }
}
