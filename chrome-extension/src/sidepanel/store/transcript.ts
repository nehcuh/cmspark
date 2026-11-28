import { isTempUserMessageId, predatesStoredMessage } from "../../utils/temp-message-id"
import type { Message } from "../types"

function mergeRow(rows: Message[], index: number, incoming: Message, id: string, clientId?: string): Message[] {
  const current = rows[index]!
  const lateEcho = id !== incoming.id
  const [preferred, other] = lateEcho ? [current, incoming] : [incoming, current]
  const attachments = preferred.attachments?.length ? preferred.attachments : other.attachments
  const files = preferred.files ?? other.files
  const alias = clientId ?? current.client_message_id
  if (id === current.id && alias === current.client_message_id &&
      attachments === current.attachments && files === current.files) return rows
  const next = rows.slice()
  next[index] = { ...current, id, ...(alias ? { client_message_id: alias } : {}), attachments, files }
  return next
}

/** Local sends, SW echoes and Companion receipts all update the same timeline. */
export function addTranscriptMessage(rows: Message[], incoming: Message, source?: "chat.user"): Message[] {
  const same = rows.findIndex(row => row.id === incoming.id)
  if (same >= 0) {
    const updated = mergeRow(rows, same, incoming, incoming.id, incoming.client_message_id)
    const clientId = incoming.client_message_id
    if (!clientId || clientId === incoming.id || incoming.role !== "user") return updated
    // History may already display the durable row while its differently formatted upload
    // caption is still pending. Only this receipt identifies both as the same turn.
    const pending = updated.find(row => row.id === clientId && row.role === "user" && row.thread_id === incoming.thread_id)
    if (!pending) return updated
    const durable = updated[same]!
    const result = updated.slice()
    result[same] = { ...durable, content: pending.content,
      attachments: durable.attachments?.length ? durable.attachments : pending.attachments,
      files: durable.files ?? pending.files }
    return result.filter(row => row !== pending)
  }
  if (incoming.role !== "user" || !incoming.thread_id) return [...rows, incoming]
  const owner = incoming.thread_id
  const clientId = incoming.client_message_id
  const temporary = isTempUserMessageId(incoming.id, owner)
  let lastUser = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if (row.role !== "user" || row.thread_id !== owner) continue
    if (lastUser < 0) lastUser = i
    if (clientId && row.id === clientId) return mergeRow(rows, i, incoming, incoming.id, clientId)
    if (temporary && row.client_message_id === incoming.id) return mergeRow(rows, i, incoming, row.id)
  }
  // A receipt naming another surface's send cannot adopt a local bubble by position.
  if (clientId || lastUser < 0) return [...rows, incoming]
  const last = rows[lastUser]!
  if (!temporary) {
    // A legacy receipt may decorate a caption with its uploaded filenames.
    const matches = rows.filter(row => row.role === "user" && row.thread_id === owner &&
      isTempUserMessageId(row.id, owner) && predatesStoredMessage(row.id, incoming.id, owner) &&
      (row.content === incoming.content || incoming.content.startsWith(row.content + "\n📎 ") ||
        row.content.startsWith(incoming.content + "\n📎 ")) &&
      (!row.attachments?.length || !incoming.attachments?.length || attachmentKey(row) === attachmentKey(incoming)))
    if (matches.length === 1) return mergeRow(rows, rows.indexOf(matches[0]!), incoming, incoming.id, matches[0]!.id)
  }
  if (temporary && !last.client_message_id && last.content === incoming.content &&
      (!incoming.attachments?.length || attachmentKey(last) === attachmentKey(incoming)) &&
      (source === "chat.user" || /_\d{10,}$/.test(incoming.id)) &&
      predatesStoredMessage(incoming.id, last.id, owner)) {
    return mergeRow(rows, lastUser, incoming, last.id, incoming.id)
  }
  return [...rows, incoming]
}

function attachmentKey(row: Message): string {
  return JSON.stringify(row.attachments?.map(a => [a.name, a.mime, a.sha256, a.bytes]) ?? [])
}

function payloadKey(row: Message): string {
  return JSON.stringify([row.thread_id, row.content, attachmentKey(row), row.files?.map(file => file.filename) ?? []])
}

/** Adopt confirmed history while preserving pending sends and live client ids omitted on disk. */
export function mergeHydratedMessages(existing: Message[], incoming: Message[]): Message[] {
  const next = Array.isArray(incoming) ? incoming : []
  if (!Array.isArray(existing) || !existing.length) return next
  const existingById = new Map(existing.map(row => [row.id, row]))
  const known = new Set<string>()
  const available = new Map<string, number[]>()
  const merged = next.map((row, index) => {
    known.add(row.id)
    if (row.role !== "user") return row
    const previous = existingById.get(row.id)
    const alias = row.client_message_id ?? previous?.client_message_id
    if (alias) known.add(alias)
    if (!previous && !alias) {
      const key = payloadKey(row)
      const slots = available.get(key)
      if (slots) slots.push(index)
      else available.set(key, [index])
    }
    return alias && alias !== row.client_message_id ? { ...row, client_message_id: alias } : row
  })
  const pending = existing.filter(row => row.role === "user" && !known.has(row.id) && isTempUserMessageId(row.id, row.thread_id))
  const pendingCounts = new Map<string, number>()
  for (const row of pending) {
    const key = payloadKey(row)
    pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + 1)
  }
  for (const row of pending) {
    const key = payloadKey(row)
    const slots = available.get(key)
    const index = slots?.length === 1 && pendingCounts.get(key) === 1 ? slots[0] : undefined
    if (index === undefined || !predatesStoredMessage(row.id, merged[index]!.id, row.thread_id)) merged.push(row)
    else merged[index] = { ...merged[index]!, client_message_id: row.id }
  }
  return merged
}
