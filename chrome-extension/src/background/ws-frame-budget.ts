// Client-side WS frame budget for file.upload.
//
// Companion rejects frames above MAX_WS_MESSAGE_SIZE (10MB) before buffering
// (`companion/src/ws/lifecycle.ts`). Service Worker must refuse earlier so the
// UI gets a stamped file.upload_error instead of a silent close.
//
// 256KB headroom covers JSON envelope / key names / hostname / skill_ids so a
// payload whose *content* is just under 10MB does not still trip the server.

export const WS_FRAME_HEADROOM = 256 * 1024
export const MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024

export function shouldRefuseWsFrame(jsonBytes: number): boolean {
  return jsonBytes > MAX_WS_MESSAGE_SIZE - WS_FRAME_HEADROOM
}
