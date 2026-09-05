/**
 * #370 — threads 正文 redact 小工具（复用 history 敏感正则族，不另立族）。
 *
 * 消费方：packs/expert-distill.ts（发给用户 LLM 前的语料脱敏）。
 * 规则来源 SINGLE SoT：redact-rules.ts（SENSITIVE_KEY_RE / SECRET_VALUE_PATTERNS
 * / hasSecretShape）——本文件只是「自由文本」形态的适配层：
 *   1. 裸密钥形状（JWT/Bearer/PEM/sk-…/ghp_… 等）→ `[已脱敏]`
 *   2. 敏感键名后的值（token: xxx / api_key=xxx / "Authorization":"…"）→ 键保留、值 `[已脱敏]`
 *   3. 兜底 fail-closed：脱敏后仍命中 hasSecretShape（未知形状）→ 整段替换
 *      `[已跳过：疑似敏感内容]`（与 #255 读档闸同向，宁可少传不可漏传）
 */
import {
  SENSITIVE_KEY_RE,
  SECRET_VALUE_PATTERNS,
  hasSecretShape,
} from "./redact-rules"

const MASK = "[已脱敏]"
const DROP = "[已跳过：疑似敏感内容]"

/** 敏感键名后跟值（`key: v` / `key=v` / `"key":"v"`）→ 键保留、值打码。 */
const SENSITIVE_KEY_VALUE_RE = new RegExp(
  `([A-Za-z0-9_"'\\-\\[\\]]*(?:${SENSITIVE_KEY_RE.source})(?:[A-Za-z0-9_"'\\-\\[\\]])*)` +
    `(\\s*[:=]\\s*)("[^"\\n]{0,4096}"|'[^'\\n]{0,4096}'|[^\\s,;"'\\[\\]}\\n]{1,4096})`,
  "gi",
)
// SENSITIVE_KEY_RE.source 自带一个捕获组，被嵌入后成为整体第 2 组——
// 回调必须按实际组序取参（key=g1, 内嵌=g2, sep=g3, value=g4）。
// 值分支同时排除 [ 与 ]：MASK「[已脱敏]」以 [ 开头，排除后二次扫描无法
// 部分重匹配，保证幂等。

function maskAll(patterns: readonly RegExp[], text: string): string {
  let out = text
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.replace("g", "") + "g")
    out = out.replace(global, MASK)
  }
  return out
}

/** 自由文本脱敏（幂等：已打码段不会再被改写）。 */
export function redactPlainText(text: string): string {
  if (!text) return text
  let out = maskAll(SECRET_VALUE_PATTERNS, text)
  out = out.replace(
    SENSITIVE_KEY_VALUE_RE,
    (_m, key: string, _embedded: string, sep: string) => `${key}${sep}${MASK}`,
  )
  if (hasSecretShape(out)) return DROP
  return out
}
