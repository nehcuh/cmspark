/** Forward the request ID so callers can correlate the authoritative snapshot. */
export function forwardConfigGet(message: { id?: unknown }, client?: { send(frame: object): boolean }): { ok: boolean; error?: string } {
  if (message.id !== undefined && (typeof message.id !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(message.id))) {
    return { ok: false, error: "INVALID_CONFIG_REQUEST_ID" }
  }
  const sent = client?.send({ type: "config.get", ...(message.id !== undefined ? { id: message.id } : {}) })
  return sent ? { ok: true } : { ok: false, error: "Companion 未连接" }
}
