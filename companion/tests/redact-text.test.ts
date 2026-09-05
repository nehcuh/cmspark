// #370 — threads 正文 redact 小工具：复用 redact-rules 敏感正则族（单一 SoT），
// 自由文本形态（语料发 LLM 前脱敏）。锁不变量：输出绝不含裸密钥形状。
import test from "node:test"
import assert from "node:assert/strict"
import { redactPlainText } from "../src/security/redact-text"
import { hasSecretShape } from "../src/security/redact-rules"

test("裸密钥形状 → [已脱敏]（JWT / sk- / ghp_ / Bearer / PEM）", () => {
  const cases = [
    "token 是 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c 吗",
    "key: sk-ant-api03-abcdef1234567890abcdef",
    "gh: ghp_16CharactersGhToken123456",
    "header 是 Bearer: abcdef1234567890abcdef",
    "-----BEGIN PRIVATE KEY-----",
  ]
  for (const c of cases) {
    const out = redactPlainText(c)
    assert.ok(out.includes("[已脱敏]"), `masked output for: ${c}`)
    assert.ok(!hasSecretShape(out), `output still carries secret shape: ${c}`)
    // 键名/上下文保留（脱敏不破坏语料可读性）
    assert.ok(out.length > 0)
  }
})

test("敏感键名后的值 → 键保留、值打码", () => {
  const out = redactPlainText('config 里 api_key: "live-secret-value-123"，token=hunter2xyz789，"Authorization": "Basic xyz"')
  assert.ok(!out.includes("live-secret-value-123"))
  assert.ok(!out.includes("hunter2xyz789"))
  assert.ok(!out.includes("Basic xyz"))
  assert.ok(out.includes("api_key"))
  assert.ok(out.includes("token"))
  assert.ok((out.match(/\[已脱敏\]/g) || []).length >= 3)
})

test("普通正文不误伤", () => {
  const text = "用户在讨论 Django 的中间件配置，聊到了 settings.py 里的 ALLOWED_HOSTS。"
  assert.equal(redactPlainText(text), text)
  assert.equal(redactPlainText(""), "")
})

test("幂等：已打码文本再过一遍不变", () => {
  const once = redactPlainText("api_key=super-secret-abcdef123456")
  assert.equal(redactPlainText(once), once)
})

test("family lockstep：输出永不命中 hasSecretShape（与 #255 落盘闸同族）", () => {
  const corpus = [
    "sk-proj-1234567890abcdef1234567890",
    "AKIAIOSFODNN7EXAMPLE",
    "AIzaSyA1234567890abcdefghijklmnopqrstu",
    "xoxb-1234567890abcdef",
    "npm_aBcdefghijklmnopqrstuvwxyz12345",
    "hf_aBcdefghijklmnopqrstuvwxyz12",
    "session 里 password=hunter2 记下来了",
  ]
  for (const c of corpus) {
    const out = redactPlainText(c)
    assert.ok(!hasSecretShape(out), `leaked shape from: ${c} → ${out}`)
  }
})
