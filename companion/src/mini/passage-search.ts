// Mini's paired, private panel can read the underlying passage without changing the active chat.
import { createHash } from 'node:crypto'
import { setImmediate as yieldToDaemon } from 'node:timers/promises'
import { KNOWLEDGE_BODY_WIRE_CAP, type KnowledgeListItem, type SkillEngine } from '../skills/skill-engine'
import { isSearchableThreadRow, knowledgeSearchRows, scoreSearchCandidate } from '../summoner/read-search'
import { redactSecrets } from '../threads/distill'
import type { ThreadManager } from '../threads/thread-manager'

type Knowledge = Pick<SkillEngine, 'listKnowledge' | 'getKnowledge'>
export type MiniHistory = Pick<ThreadManager, 'list' | 'getMessages'>
type Hit = {
  kind: 'knowledge' | 'message'
  id: string
  title: string
  snippet: string
  folder?: string
  message_id?: string
  role?: 'user' | 'assistant'
  created_at?: string
}
const PAGE_SIZE = 25

function literal(query: string) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
}

// Keep a match visible even beyond the ordinary document preview limit.
function excerpt(text: string, match: RegExpExecArray, radius: number) {
  const start = Math.max(0, match.index - radius)
  const end = Math.min(text.length, match.index + match[0].length + radius)
  const prefix = start ? '…' : ''
  return {
    body: prefix + text.slice(start, end) + (end < text.length ? '…' : ''),
    highlight: { start: prefix.length + match.index - start, length: match[0].length },
    truncated: start > 0 || end < text.length,
  }
}

function matchingMetadata(doc: KnowledgeListItem, query: string, pattern: RegExp) {
  const fields = [
    { label: '标题', text: doc.title || doc.name, pinyin: true },
    { label: '描述', text: doc.description || '' },
    { label: '标签', text: (doc.tags || []).join(' · ') },
  ]
  for (const field of fields) {
    const match = pattern.exec(field.text)
    if (match) return { label: field.label, ...excerpt(field.text, match, 70) }
  }
  const field = fields.find(f => scoreSearchCandidate([{ ...f, weight: 1 }], query) > 0)
  if (field) return { label: field.label, body: field.text.slice(0, 200), highlight: undefined }
}

export async function searchMiniPassages(knowledge: Knowledge, history: MiniHistory, query: string, offset: number, anchor?: unknown) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('无效的搜索页码')
  const pattern = literal(query)
  const threads = history.list().filter(isSearchableThreadRow).sort((a, b) =>
    (b.last_message_at || b.updated_at).localeCompare(a.last_message_at || a.updated_at) || a.id.localeCompare(b.id))
  let messages: Hit[] = []
  function retainVisibleMessages() {
    const visible = new Set(history.list().filter(isSearchableThreadRow).map(t => t.id))
    messages = messages.filter(hit => visible.has(hit.id))
  }
  const needed = offset + PAGE_SIZE + 1
  scan: for (const thread of threads) {
    // Yield between transcript files so a large history does not stall the Mini or daemon.
    await yieldToDaemon()
    const rows = history.getMessages(thread.id)
    for (let i = rows.length - 1; i >= 0; i--) {
      const m = rows[i]
      if ((m.role !== 'user' && m.role !== 'assistant') || !m.id || typeof m.content !== 'string' || !pattern.test(m.content)) continue
      const text = redactSecrets(m.content).text
      const match = pattern.exec(text)
      if (match) messages.push({
        kind: 'message', id: thread.id, message_id: m.id, title: redactSecrets(thread.alias || thread.id).text,
        role: m.role, created_at: m.created_at, snippet: excerpt(text, match, 70).body,
      })
      if (messages.length >= needed) {
        retainVisibleMessages()
        if (messages.length >= needed) break scan
      }
    }
  }

  retainVisibleMessages()

  const docs = knowledge.listKnowledge(true)
  const metadata = knowledgeSearchRows(docs, query, docs.length)
  const byId = new Map(metadata.map(hit => [hit.id, hit]))
  const knowledgeHits: Hit[] = []
  for (const doc of docs) {
    const id = doc.id || doc.name
    const text = doc.body || ''
    const match = pattern.exec(text)
    const meta = byId.get(id)
    const field = !match && meta ? matchingMetadata(doc, query, pattern) : undefined
    const snippet = match ? excerpt(text, match, 70).body : field && field.label + ' · ' + field.body
    if (snippet !== undefined) knowledgeHits.push({
      kind: 'knowledge', id, title: doc.title || doc.name, folder: doc.folder, snippet,
    })
  }
  knowledgeHits.sort((a, b) => (byId.get(b.id)?.score || 0) - (byId.get(a.id)?.score || 0) || a.id.localeCompare(b.id))

  // Interleave sources so a long conversation cannot hide a matching knowledge document or vice versa.
  const page: Hit[] = []
  const prefix = createHash('sha256')
  const stalePage = { hits: [] as Hit[], has_more: false, stale: true }
  let seen = 0
  for (let i = 0; i < Math.max(knowledgeHits.length, messages.length); i++) {
    for (const hit of [knowledgeHits[i], messages[i]]) {
      if (!hit) continue
      if (page.length === PAGE_SIZE) return { hits: page, has_more: true, anchor: prefix.digest('hex') }
      prefix.update(JSON.stringify([hit.kind, hit.id, hit.message_id])).update('\n')
      seen++
      // Activity in another window may reorder threads between pages.
      if (seen === offset && prefix.copy().digest('hex') !== anchor) return stalePage
      if (seen > offset) page.push(hit)
    }
  }
  return seen < offset ? stalePage : { hits: page, has_more: false }
}

export function readMiniPassage(knowledge: Knowledge, history: MiniHistory, request: Record<string, unknown>, query: string) {
  const pattern = literal(query)
  if (request.kind === 'knowledge') {
    const doc = knowledge.listKnowledge(true).find(d => (d.id || d.name) === request.doc_id)
    if (!doc) throw new Error('这份资料已不存在，请重新搜索')
    const text = doc.body || ''
    const match = pattern.exec(text)
    const title = doc.title || doc.name
    if (match) {
      if (Buffer.byteLength(text) > KNOWLEDGE_BODY_WIRE_CAP) return { title, ...excerpt(text, match, 6000) }
      return { title, body: text, highlight: { start: match.index, length: match[0].length }, truncated: false }
    }
    const field = matchingMetadata(doc, query, pattern)
    if (field) {
      const preview = knowledge.getKnowledge(doc.id || doc.name)
      if (preview) return { title, body: preview.body, truncated: preview.truncated, matched_field: field }
    }
  } else if (request.kind === 'message') {
    const thread = history.list().find(t => t.id === request.thread_id && isSearchableThreadRow(t))
    const message = thread && history.getMessages(thread.id).find(m => m.id === request.message_id)
    if (!thread || !message || (message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
      throw new Error('这条对话消息已不可用，请重新搜索')
    }
    const text = redactSecrets(message.content).text
    const match = pattern.exec(text)
    if (match) return {
      title: redactSecrets(thread.alias || thread.id).text, role: message.role, created_at: message.created_at,
      ...excerpt(text, match, 6000),
    }
  }
  throw new Error('原文已更新，请重新搜索')
}
