// #255 — 三态 UI 文案 acceptance tests.
//
// Persisted read-tier tool results render in exactly three states:
//   完整  — gate-passed data ≤ 8000 chars: normal rendering (existing).
//   截断  — truncated-prefix envelope: explicit "已保留前 N/共 M 字符" copy
//           that must NEVER imply the full content was persisted.
//   折叠  — redacted stub: existing "出于安全未持久化" hint (unchanged).

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("#255 ChatView renders the truncated-prefix hint with kept/total copy", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /data-testid="truncated-prefix-hint"/)
  // The copy carries both numbers （已保留前 N/共 M 字符）.
  assert.match(chat, /已保留前 \$\{truncatedPrefix\.kept\.toLocaleString\(\)\}\/共 \$\{truncatedPrefix\.total\.toLocaleString\(\)\} 字符/)
  // Honesty red line: the truncated state must disclose that the remainder is
  // NOT persisted, and must not claim the content was kept in full.
  assert.match(chat, /超出部分未落盘/)
  assert.ok(!/内容已保留/.test(chat), "must not imply 内容已保留")
  // NIT-5: 「已保留」only ever appears as the honest「已保留前」form — a future
  // edit to「内容已安全保留」style copy fails this test.
  assert.ok(!/已保留(?!前)/.test(chat), "已保留 must always be followed by 前")
})

test("#255 ChatView truncated prefix renders the prefix, not the envelope JSON", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  // resultStr falls back to the persisted prefix for truncated envelopes.
  assert.match(chat, /truncatedPrefix\s*\?\s*truncatedPrefix\.prefix/)
  // Envelope detection runs before generic rendering (and excludes stubs).
  assert.match(chat, /extractTruncatedPrefix\(tc\.result\)/)
})

test("#255 redacted-stub hint （折叠态） copy unchanged", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /data-testid="redacted-stub-hint"/)
  assert.match(chat, /出于安全未持久化/)
})
