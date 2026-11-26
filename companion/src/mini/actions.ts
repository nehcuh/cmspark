import type { CompanionClient } from '../tray/companion-client'

const captureActions = ['todo', 'ask', 'ocr', 'capture'] as const
type MiniCaptureAction = typeof captureActions[number]
export type MiniAction = MiniCaptureAction | 'search' | 'meeting'

export function isMiniCapture(action: MiniAction): action is MiniCaptureAction {
  return captureActions.some(key => key === action)
}

export function isMiniAction(key: string): key is MiniAction {
  return key === 'search' || key === 'meeting' || captureActions.some(action => action === key)
}

/** Capture actions carry the PNG from the completed region selection. */
export async function openMiniAction(client: Pick<CompanionClient, 'sendAppRequest'>, action: MiniAction, png?: Buffer): Promise<void> {
  if (isMiniCapture(action) && !png?.length) throw new Error('未取得选区截图')
  const result = await client.sendAppRequest('ui.open_sidepanel', {
    destination: 'mini_' + action,
    ...(png ? { image_base64: png.toString('base64') } : {}),
  }, 8_000)
  if (result?.type !== 'ui.open_sidepanel.opened' || result.destination !== 'mini_' + action) throw new Error(result?.error || '请使用支持 Mini 的 Companion 和 Chrome 扩展')
}
