// A2/A4 — bilingual danger lexicon + dual-channel classification.
//
// Detection input is DUAL-CHANNEL (A2.2): the pre-click region crop (~200×200,
// i.e. the thing being clicked) AND the whole window OCR text.
//   - HARD set hit in the REGION  → the click target itself is a payment /
//     transfer / captcha final-confirm → A4 HARD DENY, no re-L2 path exists.
//   - HARD set hit in the WINDOW (region clean) → sensitive financial context →
//     pause + re-L2 with explicit reason (E.4 row 4, has a path).
//   - CAUTION set hit in the REGION → destructive-ish target → pause + re-L2.
//   - CAUTION set in the WINDOW only → recorded in evidence, no pause.
//
// Matching semantics (review R3): Latin tokens match on word boundaries
// (\b) so "pin" does not fire inside "shopping" nor "format" inside
// "information"; CJK tokens stay plain substring. Bare "Pay" IS enumerated
// (A2.2) — a final payment button is often labelled exactly that.
//
// Documented evadability (A2.3): image-rendered text and owner-drawn fonts are
// invisible to OCR — compensation is the A1.2 independent-channel region check
// plus the A2.1 task-induced-dialog invariant, NOT a bigger word list.

import type { OcrWord, RectPx } from "./types"

/** A4 — final-confirm semantics: clicking these is never permitted. */
export const HARD_DENY_WORDS: readonly string[] = [
  // zh
  "确认支付", "立即支付", "立即付款", "确认付款", "支付", "转账", "付款", "购买",
  "付款码", "验证码", "银行卡", "确认购买", "免密支付",
  // en
  // "pay" is listed BARE (A2.2 enumeration): a final payment button is often
  // labelled exactly "Pay". Word-boundary matching (below) keeps it from
  // firing inside "payment" — that entry stands on its own.
  "pay", "confirm payment", "pay now", "payment", "transfer", "purchase", "buy now",
  "checkout", "captcha", "verification code", "card number", "confirm purchase",
  // Deliberately NOT listed bare: "confirm" / "确认" — every ordinary
  // confirmation dialog carries it, so a bare listing would hard-deny normal
  // work (the A2.1 dialog invariant already force-pauses those). Only
  // payment/destructive COMPOUNDS ("confirm payment", "confirm purchase",
  // "确认支付", "确认删除") are enumerated.
]

/** A2 — destructive/irreversible semantics: pause + re-L2. */
export const CAUTION_WORDS: readonly string[] = [
  // zh
  "确认删除", "永久删除", "彻底删除", "删除", "清空", "移除", "卸载", "格式化", "永久",
  // en
  "confirm delete", "delete", "remove", "erase", "format", "uninstall", "wipe",
  "permanently", "confirm removal",
]

/** A7.4 — credential semantics: neighborhoods are pixelated before evidence persists. */
export const CREDENTIAL_WORDS: readonly string[] = [
  "密码", "口令", "密码框", "pin码", "密码输入",
  "password", "passwd", "pin", "credential",
]

export type DangerLevel = "none" | "caution" | "hard"

export interface DangerScan {
  regionLevel: DangerLevel
  windowLevel: DangerLevel
  regionHits: string[]
  windowHits: string[]
  /** 200×200 neighborhoods around credential-word hits (window coords), for pre-seal blur. */
  credentialRects: RectPx[]
}

function normalize(text: string): string {
  // Y2 (WP2): NFKC folds full-width/half-width lookalikes (Ｐａｙ → pay,
  // ！→ !, 全角空格 → space) and zero-width codepoints (U+200B..U+200D,
  // FEFF) are stripped — both are one-keystroke evasions against lexicon
  // matching. NFKC leaves ordinary CJK untouched, so the zh lexicon is safe.
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
}

// Review R3/N2: pure substring matching both MISSES (nothing) and over-fires
// for Latin tokens — "pin" ⊂ "shopping", "format" ⊂ "information". Latin
// (ASCII) tokens therefore match on WORD BOUNDARIES (\b); CJK tokens have no
// word-boundary concept and stay plain substring. \b is ASCII-centric
// (\w = [A-Za-z0-9_]), so "pin码" still matches \bpin\b — desirable for the
// credential set.
const ASCII_TOKEN_RE = /^[\x00-\x7F]+$/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const latinMatchers = new Map<string, RegExp>()

function tokenMatches(hayLower: string, tokenLower: string): boolean {
  if (!ASCII_TOKEN_RE.test(tokenLower)) return hayLower.includes(tokenLower)
  let re = latinMatchers.get(tokenLower)
  if (!re) {
    re = new RegExp(`\\b${escapeRegExp(tokenLower)}\\b`)
    latinMatchers.set(tokenLower, re)
  }
  return re.test(hayLower)
}

/** Longest-match-first scan; returns matched lexicon entries (deduped). */
export function matchWords(text: string, lexicon: readonly string[]): string[] {
  const hay = normalize(text)
  const sorted = [...lexicon].sort((a, b) => b.length - a.length)
  const hits: string[] = []
  for (const w of sorted) {
    if (tokenMatches(hay, normalize(w)) && !hits.includes(w)) hits.push(w)
  }
  return hits
}

function levelOf(text: string): { level: DangerLevel; hits: string[] } {
  const hard = matchWords(text, HARD_DENY_WORDS)
  if (hard.length > 0) return { level: "hard", hits: hard }
  const caution = matchWords(text, CAUTION_WORDS)
  if (caution.length > 0) return { level: "caution", hits: caution }
  return { level: "none", hits: [] }
}

function centerInRect(w: OcrWord, r: RectPx): boolean {
  const cx = w.x + w.w / 2
  const cy = w.y + w.h / 2
  return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height
}

/**
 * Dual-channel scan. `words` is the whole-window OCR result; `region` is the
 * pre-click crop rect in the same coordinate space (window client px).
 */
export function scanDanger(words: OcrWord[], region: RectPx, cropSize: number): DangerScan {
  const windowText = words.map((w) => w.text).join(" ")
  const regionText = words
    .filter((w) => centerInRect(w, region))
    .map((w) => w.text)
    .join(" ")
  const r = levelOf(regionText)
  const w = levelOf(windowText)

  const credentialRects: RectPx[] = []
  for (const word of words) {
    if (matchWords(word.text, CREDENTIAL_WORDS).length === 0) continue
    const half = cropSize / 2
    credentialRects.push({
      x: Math.max(0, Math.round(word.x + word.w / 2 - half)),
      y: Math.max(0, Math.round(word.y + word.h / 2 - half)),
      width: cropSize,
      height: cropSize,
    })
  }

  return {
    regionLevel: r.level,
    windowLevel: w.level,
    regionHits: r.hits,
    windowHits: w.hits,
    credentialRects,
  }
}
