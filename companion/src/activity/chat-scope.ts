import { createHash } from 'node:crypto'
import { decodePngToRgba } from '../computer/png-decode'
import { encodePngRgba } from '../llm/image-preview'
import { ActivityError, isActivityAppId, type ActivityChatProfile, type ActivityConfig, type ActivityRect } from './types'
import { hasActivityTitleConsent } from './model-config'
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
      keys(profile, ['window_class', 'width', 'height', 'logical_width', 'logical_height', 'content', 'title', 'allowed_titles'])
      if (typeof profile.window_class !== 'string' || !profile.window_class.trim() || profile.window_class.length > 256 || !Number.isSafeInteger(profile.width) || !Number.isSafeInteger(profile.height) || Number(profile.width) < 1 || Number(profile.height) < 1 || Number(profile.width) > 8192 || Number(profile.height) > 8192 || Number(profile.width) * Number(profile.height) > 16_777_216) throw new ActivityError('INVALID_REQUEST', '聊天窗口布局无效')
      if (profile.logical_width !== undefined || profile.logical_height !== undefined) {
        const logical = [profile.logical_width, profile.logical_height]
        if (logical.some(n => !Number.isSafeInteger(n) || Number(n) < 1 || Number(n) > 8192) ||
          Number(profile.logical_width) * Number(profile.height) !== Number(profile.logical_height) * Number(profile.width))
          throw new ActivityError('INVALID_REQUEST', '窗口逻辑尺寸与截图比例不一致，请重新校准')
      }
      validateActivityRect(profile.content, Number(profile.width), Number(profile.height)); validateActivityRect(profile.title, Number(profile.width), Number(profile.height))
      if (!containsRect(profile.content, profile.title) || !Array.isArray(profile.allowed_titles) || profile.allowed_titles.length < 1 || profile.allowed_titles.length > 20 || profile.allowed_titles.some(title => typeof title !== 'string' || !title.trim() || title.length > 200 || title !== title.trim())) throw new ActivityError('INVALID_REQUEST', '标题区域须位于聊天内容内，并填写完整允许标题')
      const key = chatProfileKey(profile as unknown as ActivityChatProfile)
      if (layouts.has(key)) throw new ActivityError('INVALID_REQUEST', '相同窗口布局只能保留一份校准，请明确替换旧范围')
      layouts.add(key)
    }
  }
}
export function profileForFrame(config: ActivityConfig, appId: string, windowClass: string | undefined, image: Buffer, logicalSize?: { width: number; height: number }): ActivityChatProfile | undefined {
  const scopes = config.chat_scopes?.filter(scope => scope.app_id === appId) || []
  if (!scopes.length) return undefined
  if (scopes.length !== 1 || !scopes[0].profiles.length) throw new ActivityScopeSkip('scope_uncalibrated', '此应用已限定对话，但尚未校准聊天区域；请先完成校准')
  const size = imageSize(image)
  const layouts = scopes[0].profiles.filter(p => p.window_class === windowClass)
  const sameLogicalSize = (p: ActivityChatProfile) =>
    logicalSize !== undefined && p.logical_width === logicalSize.width && p.logical_height === logicalSize.height
  const exact = layouts.find(p => p.width === size.width && p.height === size.height &&
    (p.logical_width === undefined || sameLogicalSize(p)))
  if (exact) return exact
  const scalable = layouts.filter(p => sameLogicalSize(p) && size.width * p.height === size.height * p.width)
  if (scalable.length === 1) {
    const p = scalable[0]
    const scaleRect = (r: ActivityRect): ActivityRect => {
      // Round inwards so resampling can never authorize another pixel outside the marked region.
      const x = Math.ceil(r.x * size.width / p.width), y = Math.ceil(r.y * size.height / p.height)
      return { x, y, width: Math.floor((r.x + r.width) * size.width / p.width) - x,
        height: Math.floor((r.y + r.height) * size.height / p.height) - y }
    }
    const content = scaleRect(p.content), title = scaleRect(p.title)
    if (title.width > 0 && title.height > 0 && containsRect(content, title))
      return { ...p, ...size, content, title }
  }
  throw new ActivityScopeSkip('scope_layout_changed', '当前聊天窗口布局或尺寸尚未校准；请重新设置聊天区域')
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

export interface ChatTitleCheck { image: Buffer; allowedTitles: string[] }
export interface ScopedTitle { conversation_title?: string; titleCheck?: ChatTitleCheck }

export async function checkChatTitle(config: ActivityConfig, profile: ActivityChatProfile, signal: AbortSignal,
  local: () => Promise<string>, titleCrop: () => Buffer | Promise<Buffer>): Promise<ScopedTitle> {
  let title = '', localError: unknown
  try { title = await local() } catch (error) { localError = error }
  signal.throwIfAborted()
  if (title && profile.allowed_titles.includes(title)) return { conversation_title: title }
  if (hasActivityTitleConsent(config)) {
    if (profile.title.width === profile.content.width && profile.title.height === profile.content.height)
      throw new ActivityScopeSkip('scope_unreadable', '请在消息区内单独框选标题文字，再使用模型标题核验')
    return { titleCheck: { image: await titleCrop(), allowedTitles: profile.allowed_titles } }
  }
  if (localError instanceof ActivityError && localError.code === 'OCR_LANGUAGE_MISSING') throw localError
  if (!title) throw new ActivityScopeSkip('scope_unreadable', '当前聊天标题无法在本机识别；请核对 OCR 语言与标题区域')
  throw new ActivityScopeSkip('scope_title_mismatch', '当前聊天标题不在允许名单，已跳过且未保存截图')
}

export async function scopeLocalFrame(config: ActivityConfig, appId: string, windowClass: string | undefined, image: Buffer,
  signal: AbortSignal, readTitle: (crop: Buffer) => Promise<string>, logicalSize?: { width: number; height: number }): Promise<{ image: Buffer } & ScopedTitle> {
  const profile = profileForFrame(config, appId, windowClass, image, logicalSize)
  if (!profile) return { image }
  const crop = activityImageCrop(image), title = crop(profile.title)
  const scoped = await checkChatTitle(config, profile, signal, () => readTitle(title), () => title)
  return { image: crop(profile.content), ...scoped }
}
