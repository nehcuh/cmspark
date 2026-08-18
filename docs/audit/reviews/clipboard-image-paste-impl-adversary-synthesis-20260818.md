# Multi-adversarial synthesis — clipboard image paste IMPLEMENTATION

**Date**: 2026-08-18  
**Branch**: `feat/clipboard-image-paste` @ `8e3a24e` (+ later docs)  
**Base**: `54f76a5` (`main`)  
**Worktree**: `.worktrees/feat-clipboard-image-paste`  
**Spec**: `docs/superpowers/specs/2026-08-17-clipboard-image-paste-design.md`  
**Blast**: T2

## MACHINE

| Suite | Result |
|-------|--------|
| companion targeted (likely-multimodal, sniff, parts, anthropic, budget, sidecar, adapter, split-upload, file-parser, logger-redact) | **105 pass / 0 fail** `[executed]` |
| extension targeted (image-compose, vision-reuse, ws-frame-budget) | **42 pass / 0 fail** `[executed]` |
| `tsc --noEmit` chrome-extension | PASS `[executed]` |

Full companion `npm test` not re-run (known unrelated `computer-uia-watch` failures on HEAD).

## Lane verdicts

| Lane | VERDICT | Blocking themes |
|------|---------|-----------------|
| Product/UX | **REJECT** | Empty history thumbs (no `preview_jpeg_b64`); ghost user + chips cleared on SW ok before companion admit; dest host ignores `config_override.base_url` |
| Security | **APPROVE_WITH_NITS** | No path escape / fetch / clipboardRead / WS 1009 on Side Panel path. Nits: dest mislabel; missing `<untrusted-image>`; HEIC/SVG become docs; drop classifier incomplete; companion 256KiB headroom only on SW |
| Architecture | **APPROVE_WITH_NITS** | Hydrate-after-rebuild + reserved-id lockstep + native skip analyzeImage + Anthropic blocks hold. Nits: token estimate ≈3 not 1600; edit+regen strips §5.1a; sidecar before vision-off fail; §5.1a 📎 order swapped |

**Overall ADVERSARY: REJECT** — Product Outcome holes (P1 thumbs, ghost send, dest override) are locked spec, not nits.

## Locked must-fix before MERGE (do not waive)

| ID | Fix |
|----|-----|
| M1 | Companion generates `preview_jpeg_b64` (≤8KB/96px) at persist **or** optimistic blob thumbs that survive `chat.user` merge. Empty tile ≠ P1. |
| M2 | Do not keep a ghost user + ❌. Chips stay until `file.uploaded`; restore on `file.upload_error`. Prefer no optimistic user until persist. |
| M3 | Dest chip + first-send ack use **effective** `{...llm, ...config_override}.base_url` hostname; ack ISO; line before pixels leave. |
| M4 | `estimateMessagesTokens` adds `estimateImagePartTokens` numerically, not via `estimateTokens("[image:1600]")`. |
| M5 | Edit+regen must keep `<!-- 用户附图分析 -->` on disk (splice caption). |
| M6 | Do not write sidecars until `planStandaloneImageAnalysis` succeeds; `image/*` that fails `normalizeImageMime` refuse (not parseFile as doc). |

## Residual (named, after must-fix)

- Pixel prompt injection (same class as screenshot rail); still want `<untrusted-image name>`
- Prefix magic / GIFAR if thumbs stay `<img>`
- Companion WS headroom vs SW-only refuse (non-SW HMAC peer)
- Tray origin still allowed for `file.upload` (HMAC first-party)
- Empty `File.type` paste ignored (fail-closed UX)

## Capability declaration

```text
Surface:      L0 (chat composer attachments — no new CDP/tool)
L2-classes:   (none)
Compose:      none
Autonomy:     single
Trust:        user-initiated image bytes → effective chat LLM (native)
              or config.vision (text-only). No new confirm dialect.
Channel:      community
```

## Dual review — 2026-08-18 08:57

| Judge | VERDICT |
|-------|---------|
| Claude | **REJECT** — confirmed M1–M6; Product blockers not nits |
| Pi | **REJECT** — independently re-ran suites; same six blockers |

`both_approve=false` · `clipboard-image-paste-impl-verdict-20260818-085744.json`

Pi extra machine: companion full 2934 pass / 15 fail (pre-existing, same set on main); extension **698/698**.

## Eval gate card

**Blast tier**: T2  
**MACHINE**: PASS (targeted 105+42; extension full 698; companion 15 fails pre-existing)  
**ADVERSARY**: **REJECT** (Product)  
**PI_REREVIEW**: **REJECT**  
**CLAUDE**: **REJECT**  
**MERGE**: **NO**

Next: fold M1–M6 on `feat/clipboard-image-paste`, then adversary r2 + dual r2.
