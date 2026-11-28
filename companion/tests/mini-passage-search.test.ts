import './helpers/require-isolated-config-825'
import test from 'node:test'
import assert from 'node:assert/strict'
import { initDataDir } from '../src/config'
import { miniPanelRequest } from '../src/mini/panel-request'
import { KNOWLEDGE_BODY_WIRE_CAP, SkillEngine } from '../src/skills/skill-engine'
import { ThreadManager } from '../src/threads/thread-manager'

test('Mini finds a late knowledge passage and individual saved turns, then reads their exact current source', async () => {
  await initDataDir()
  const knowledge = new SkillEngine()
  const threads = new ThreadManager()
  const panel = { panelId: 'local', surface: 'panel', origin: 'chrome-extension://test', isCurrentSession: () => true }
  const query = '量子计算'
  const request = (op: string, payload: Record<string, unknown>) =>
    miniPanelRequest({ op, query, scope: 'passages', ...payload }, panel, knowledge, threads)
  const note = knowledge.importKnowledge(`---
name: mini-passage-note
title: 讲义
description: 教学笔记
type: domain_knowledge
tags: [题库]
---
${'a'.repeat(KNOWLEDGE_BODY_WIRE_CAP + 32)}

讲师提到量子计算的例子。
`)
  assert.equal(knowledge.getKnowledge(note.id)?.body.includes(query), false)
  const byTag = await request('search', { query: '题库' })
  assert.ok('hits' in byTag && byTag.hits?.[0]?.snippet.includes('题库'))
  const tagDetail = await request('read', { query: '题库', kind: 'knowledge', doc_id: note.id })
  assert.ok('doc' in tagDetail && tagDetail.doc && 'matched_field' in tagDetail.doc)
  assert.equal(tagDetail.doc.matched_field?.label, '标签')
  assert.equal(tagDetail.doc.matched_field?.body, '题库')
  assert.deepEqual(tagDetail.doc.matched_field?.highlight, { start: 0, length: 2 })
  const chat = threads.create('课堂讨论')
  const add = (role: 'user' | 'assistant' | 'system' | 'tool', content: string) =>
    threads.addMessage(chat.id, { thread_id: chat.id, role, content })
  add('user', '先讨论课程安排')
  const asks = add('user', '我们会讨论量子计算吗？')
  const reply = add('assistant', '背景。'.repeat(5000) + '量子计算是下周的议题。')
  const hidden = add('tool', '量子计算不应出现在结果')
  add('system', '量子计算不应出现在结果')

  const result = await request('search', {})
  assert.ok('hits' in result && 'has_more' in result)
  assert.equal(result.has_more, false)
  assert.deepEqual(result.hits.map(hit => [hit.kind, hit.id, hit.message_id]), [
    ['knowledge', note.id, undefined], ['message', chat.id, reply.id], ['message', chat.id, asks.id],
  ])
  assert.ok(result.hits.every(hit => hit.snippet.includes(query) && hit.snippet.length < 200))
  for (const [source, expected] of [
    [{ kind: 'knowledge', doc_id: note.id }, '讲师提到量子计算的例子。'],
    [{ kind: 'message', thread_id: chat.id, message_id: reply.id }, '量子计算是下周的议题。'],
  ] as const) {
    const detail = await request('read', source)
    assert.ok('doc' in detail && detail.doc && 'highlight' in detail.doc && detail.doc.highlight)
    const { start, length } = detail.doc.highlight
    assert.equal(detail.doc.body.slice(start, start + length), query)
    assert.ok(detail.doc.body.includes(expected))
  }
  assert.equal((await request('read', { kind: 'message', thread_id: chat.id, message_id: hidden.id })).ok, false)
  for (let i = 0; i < 26; i++) add('user', '又一次讨论量子计算')
  const first = await request('search', {})
  assert.ok('anchor' in first && first.anchor && first.has_more)
  const rest = await request('search', { offset: 25, anchor: first.anchor })
  assert.ok('has_more' in rest && !rest.has_more)
  assert.equal(first.hits.length, 25)
  assert.equal(rest.hits.length, 4)
  const keys = [...first.hits, ...rest.hits].map(h => h.message_id || h.id)
  assert.equal(new Set(keys).size, 29)
  const late = threads.create('另一节课')
  threads.addMessage(late.id, { thread_id: late.id, role: 'user', content: query })
  const stale = await request('search', { offset: 25, anchor: first.anchor })
  assert.ok('stale' in stale && stale.stale)
  threads.trash(late.id)
  const inFlight = request('search', {})
  threads.trash(chat.id)
  const filtered = await inFlight
  assert.ok('hits' in filtered && filtered.hits?.every(h => h.id !== chat.id))
  assert.equal((await request('read', { kind: 'message', thread_id: chat.id, message_id: reply.id })).ok, false)
  const after = await request('search', {})
  assert.ok('hits' in after && after.hits?.length === 1)
  const miss = await request('search', { query: '不存在的关键词' })
  assert.ok('hits' in miss && miss.hits?.length === 0)
  const denied = await miniPanelRequest({ op: 'search', scope: 'passages', query }, { ...panel, surface: 'tray' }, knowledge, threads)
  assert.equal(denied.ok, false)
})

test('removing earlier hits during a scan keeps the remaining matches in the current thread reachable', async () => {
  await initDataDir()
  const threads = new ThreadManager(), knowledge = new SkillEngine()
  const query = '换页时仍可找到'
  function createChat(title: string, count: number) {
    const thread = threads.create(title)
    for (let i = 0; i < count; i++) threads.addMessage(thread.id, { thread_id: thread.id, role: 'user', content: query })
    return thread
  }
  const remaining = createChat('保留', 40), removed = createChat('移除', 25)
  const history = {
    list: () => threads.list(),
    getMessages(id: string) {
      if (id === removed.id) setImmediate(() => threads.trash(id))
      return threads.getMessages(id)
    },
  }
  const panel = { panelId: 'local', surface: 'panel', origin: 'chrome-extension://test', isCurrentSession: () => true }
  const search = (payload = {}) => miniPanelRequest({ op: 'search', scope: 'passages', query, ...payload }, panel, knowledge, history)
  const first = await search()
  assert.ok('anchor' in first && first.anchor && first.has_more && first.hits.length === 25)
  const rest = await search({ offset: 25, anchor: first.anchor })
  assert.ok('has_more' in rest && !rest.has_more && rest.hits.length === 15)
  const hits = [...first.hits, ...rest.hits]
  assert.ok(hits.every(hit => hit.id === remaining.id))
  assert.equal(new Set(hits.map(hit => hit.message_id)).size, 40)
})
