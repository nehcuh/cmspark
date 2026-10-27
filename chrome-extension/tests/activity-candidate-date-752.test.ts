import test from 'node:test'
import assert from 'node:assert/strict'
import { datetimeInput, datetimeISO, taskDatePatch } from '../src/sidepanel/components/personal-workspace/activity-request'

test('752 unchanged candidate preserves the server deadline and edits remain explicit', () => {
  const original = '2026-10-29T10:00:45.000Z'
  const initial = { due: datetimeInput(original), remind: '' }
  assert.deepEqual(taskDatePatch(true, initial, { ...initial }), { remind_at: null })
  assert.deepEqual(taskDatePatch(true, initial, { ...initial, due: '' }), { due_at: null, remind_at: null })
  const edited = '2026-10-30T18:15'
  assert.deepEqual(taskDatePatch(true, initial, { ...initial, due: edited }), { due_at: datetimeISO(edited), remind_at: null })
})
