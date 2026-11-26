import type { CompanionClient } from '../tray/companion-client'

const miniActions = ['search', 'todo', 'ask', 'ocr', 'capture'] as const
export type MiniAction = typeof miniActions[number]

export function isMiniAction(key: string): key is MiniAction {
  return miniActions.some(action => action === key)
}

/** The tray has already hidden the orb and completed the user's region selection. */
export async function openMiniAction(client: Pick<CompanionClient, 'sendAppRequest'>, action: MiniAction, png?: Buffer): Promise<void> {
  if (action !== 'search' && !png?.length) throw new Error('未取得选区截图')
  const result = await client.sendAppRequest('ui.open_sidepanel', {
    destination: 'mini_' + action,
    ...(png ? { image_base64: png.toString('base64') } : {}),
  }, 8_000)
  if (result?.type !== 'ui.open_sidepanel.opened' || result.destination !== 'mini_' + action) throw new Error(result?.error || '请使用支持 Mini 的 Companion 和 Chrome 扩展')
}
