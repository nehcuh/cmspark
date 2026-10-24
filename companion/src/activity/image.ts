import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ActivityError, type ActivityConfig } from './types'
export type LocalLanguage = 'zh-Hans' | 'zh-Hant' | 'en-US'
export const languageOf = (config: ActivityConfig): LocalLanguage => config.ocr_language || 'zh-Hans'

/** Reject oversized/ambiguous image inputs before handing bytes to a native decoder. */
export function validatePng(image: Buffer): void {
  if (image.length < 33 || image.length > 8 * 1024 * 1024 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || image.toString('ascii', 12, 16) !== 'IHDR') throw new ActivityError('INVALID_IMAGE', '请选择不超过 8 MB 的 PNG 截图')
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) throw new ActivityError('INVALID_IMAGE', '截图尺寸超过本地 OCR 的限制')
}

export async function withPendingImage<T>(root: string, image: Buffer | null, run: (file: string) => Promise<T>): Promise<T> {
  const file = path.join(root, `pending-${randomUUID()}.png`)
  fs.writeFileSync(file, image || Buffer.alloc(0), { flag: 'wx', mode: 0o600 })
  try { return await run(file) } finally { fs.rmSync(file, { force: true }) }
}
