# Thread Hygiene Implementation Plan

> **For agentic workers:** Implemented on `feat/thread-hygiene`. SoT: `docs/superpowers/specs/2026-08-17-thread-hygiene-adversarial-design.md`.

**Goal:** 近端工作集不再把空壳 / 失败编程接力 / 「未命名+#id」当对等真聊。

**Architecture:** H1 规则+呈现+整理召回；H2 `commitThreadAlias` + ACP 终态闭枚举。三路对抗 REJECT 后修：活跃草稿、body 失败词、Trust exceptId、终态漏钩/双写、batch≤50。

**Tech Stack:** Companion Node + Chrome Side Panel React. Zero new LLM on organize.

---

## Done

- [x] H1 rules + gold fixtures
- [x] H1 display ladder + ThreadList
- [x] H1 listWithPreviews / suggest_cleanup / cleanupEmpty skip active
- [x] H2 alias commit + ACP terminal sink
- [x] Adversarial must-fix pass

## Verify

```bash
npx tsc -p companion/tsconfig.test.json
node --test companion/.test-dist/tests/thread-cleanup-context.test.js companion/.test-dist/tests/alias-commit.test.js
npx tsx --test chrome-extension/tests/thread-timeline.test.ts
```
