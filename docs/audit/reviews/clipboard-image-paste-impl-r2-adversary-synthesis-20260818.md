# Adversary r2 synthesis — clipboard image paste impl (M1–M6 fold)

**Date**: 2026-08-18  
**HEAD**: post `b744d42` + canvas preview commit  
**Base**: `main` (`54f76a5`)

## r1 → r2

| ID | r1 | r2 |
|----|----|----|
| M1 thumbs | REJECT | **closed** — `makePreviewB64` + chat.user attachments; canvas for large JPEG |
| M2 ghost/chips | REJECT | **closed** — no optimistic user; chips on `file.uploaded` only |
| M3 dest host | REJECT | **closed** — `config_override.base_url`; ISO ack; line before send |
| M4 tokens | REJECT | **closed** — `estimateMessagesTokens` += 1600 |
| M5 edit splice | REJECT | **closed** — `spliceEditedCaption` on regenerate |
| M6 sidecar/HEIC | REJECT | **closed** — plan then write; `image/heic` refused |

## Lane r2

| Lane | VERDICT |
|------|---------|
| Product | APPROVE_WITH_NITS |
| Architecture | APPROVE_WITH_NITS |
| Security | APPROVE_WITH_NITS |

**ADVERSARY r2: APPROVE_WITH_NITS**

Named leftovers: 2800 unused without dims; companion WS 10MiB hard cap; no `<untrusted-image>`; typeless `.heic` still docs; dest-ack storage race.

## MACHINE (fold session)

companion helpers after fold: context-budget / split-upload / image-preview green `[executed]`.  
Prior targeted 105 + extension 42 / 698 still apply; fold added tests.

## Dual r2 — 2026-08-18

| Judge | VERDICT |
|-------|---------|
| Pi | **APPROVE_WITH_NITS** — `…-impl-r2-pi-20260818-094224.md` (re-ran 47 companion fold tests + extension 698) |
| Claude | **UNKNOWN** — API 529 twice (`…-r2-claude-20260818-094224.md`, retry `…-claude-retry-20260818.md`). Infra, not a content REJECT. |

Default confirm order (独立对抗 → Pi) is **APPROVE\***. Claude dual is optional supplement and did not complete.

## Eval gate card

**Blast**: T2  
**MACHINE**: PASS (fold + Pi re-run)  
**ADVERSARY r2**: APPROVE_WITH_NITS  
**PI_REREVIEW**: APPROVE_WITH_NITS  
**CLAUDE**: UNKNOWN (529)  
**MERGE**: **YES** under default 对抗→Pi 序. Retry Claude when the gateway is healthy if you want the optional dual line.

## Capability

```text
Surface: L0 | L2-classes: (none) | Compose: none | Autonomy: single
Trust: user images → effective LLM or vision | no new confirm
Channel: community
```
