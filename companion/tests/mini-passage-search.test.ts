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
---
${'a'.repeat(KNOWLEDGE_BODY_WIRE_CAP + 32)}

讲师提到量子计算的例子。
`)
  assert.equal(knowledge.getKnowledge(note.id)?.body.includes(query), false)
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
  const first = await request('search', {}), rest = await request('search', { offset: 25 })
  assert.ok('has_more' in first && first.has_more)
  assert.ok('has_more' in rest && !rest.has_more)
  assert.equal(first.hits.length, 25)
  assert.equal(rest.hits.length, 4)
  const keys = [...first.hits, ...rest.hits].map(h => h.message_id || h.id)
  assert.equal(new Set(keys).size, 29)
  threads.trash(chat.id)
  assert.equal((await request('read', { kind: 'message', thread_id: chat.id, message_id: reply.id })).ok, false)
  const after = await request('search', {})
  assert.ok('hits' in after && after.hits?.length === 1)
  const miss = await request('search', { query: '不存在的关键词' })
  assert.ok('hits' in miss && miss.hits?.length === 0)
  const denied = await miniPanelRequest({ op: 'search', scope: 'passages', query }, { ...panel, surface: 'tray' }, knowledge, threads)
  assert.equal(denied.ok, false)
})
