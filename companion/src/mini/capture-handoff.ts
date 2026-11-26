import { randomUUID } from 'node:crypto'
import { validatePng } from '../activity/image'
import type { MiniAction } from './actions'

export function miniDestination(value: unknown): MiniAction | undefined {
  switch (value) {
    case 'mini_capture': return 'capture'
    case 'mini_todo': return 'todo'
    case 'mini_ask': return 'ask'
    case 'mini_ocr': return 'ocr'
    case 'mini_search': return 'search'
  }
}

/** Desktop selection supplies no Chrome profile identity. An arbitrary paired peer is not the action owner. */
export function miniPanelOwner<T>(connected: T[]): T | undefined {
  if (connected.length > 1) throw new Error('已连接多个 Chrome 配置文件，请只保留目标配置文件的 CMspark 扩展连接后重试')
  return connected[0]
}

export function miniPng(encoded: unknown): Buffer {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > 8 * 1024 * 1024) throw new Error('只支持 6 MiB 以内的 PNG 截图')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) throw new Error('截图编码无效')
  validatePng(bytes)
  return bytes
}

/** Only the opaque ticket travels in the open-window broadcast. Bytes are claimed once by a paired panel. */
export class MiniCaptureHandoff {
  private pending = new Map<string, { action: MiniAction; panelId: string; bytes: Buffer; expiry: NodeJS.Timeout }>()
  constructor(private ttlMs = 90_000) {}

  stage(action: MiniAction, encoded: unknown, panelId: string): string {
    const bytes = miniPng(encoded)
    if (this.pending.size >= 4) throw new Error('已有截图正在打开，请稍后再试')
    const ticket = randomUUID()
    const expiry = setTimeout(() => this.discard(ticket), this.ttlMs)
    expiry.unref()
    this.pending.set(ticket, { action, bytes, expiry, panelId })
    return ticket
  }

  claim(action: unknown, ticket: unknown, panelId: string): Buffer {
    const record = typeof ticket === 'string' && this.pending.get(ticket)
    if (!record || record.action !== action || record.panelId !== panelId) throw new Error('截图已领取或已过期，请重新框选')
    this.discard(ticket as string)
    return record.bytes
  }

  discard(ticket: string): void {
    const record = this.pending.get(ticket)
    if (record) clearTimeout(record.expiry)
    this.pending.delete(ticket)
  }
}

export const miniCaptures = new MiniCaptureHandoff()
