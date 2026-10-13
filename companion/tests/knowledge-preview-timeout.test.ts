// #270 — parseFileBounded: a hanging parseFile (malformed office file making
// officeparser.convert never settle) must surface as a normal timeout error
// instead of leaving knowledge.preview / import_directory waiting forever.

import { test } from "node:test"
import * as assert from "node:assert/strict"

import { parseFileBounded } from "../src/message-router"
import type { FileParseResponse } from "../src/file-parser"

const neverResolves = () => new Promise<FileParseResponse>(() => {})

const okResult: FileParseResponse = {
  success: true,
  text: "hello",
  filename: "a.txt",
  mimeType: "text/plain",
  fileSize: 5,
}

const failResult: FileParseResponse = {
  success: false,
  error: "文件解析失败: boom",
  filename: "b.docx",
  mimeType: "application/octet-stream",
}

test("hanging parseFile rejects with 解析超时", async () => {
  let parseSignal: AbortSignal | undefined
  await assert.rejects(
    parseFileBounded(Buffer.from("PK fake"), "stuck.docx", "application/octet-stream", 20, async (_buffer, _name, _mime, options) => {
      parseSignal = options?.signal
      return neverResolves()
    }),
    /文件 "stuck\.docx" 解析超时 \(\d+s\)/,
  )
  assert.equal(parseSignal?.aborted, true)
})

test("parent cancellation is forwarded to injected parsers", async () => {
  const parent = new AbortController()
  let parseSignal: AbortSignal | undefined
  const parsing = parseFileBounded(Buffer.from("PK fake"), "stuck.docx", "application/octet-stream", 1000, async (_buffer, _name, _mime, options) => {
    parseSignal = options?.signal
    return neverResolves()
  }, parent.signal)
  parent.abort()
  await assert.rejects(parsing, /取消/)
  assert.equal(parseSignal?.aborted, true)
})

test("settled parseFile result passes through before the timeout", async () => {
  const r = await parseFileBounded(Buffer.from("hello"), "a.txt", "text/plain", 1000, async () => okResult)
  assert.equal(r, okResult)
})

test("parseFile failure result passes through (not a timeout)", async () => {
  const r = await parseFileBounded(Buffer.from("x"), "b.docx", "application/octet-stream", 1000, async () => failResult)
  assert.equal(r.success, false)
  if (!r.success) assert.match(r.error, /文件解析失败/)
})
