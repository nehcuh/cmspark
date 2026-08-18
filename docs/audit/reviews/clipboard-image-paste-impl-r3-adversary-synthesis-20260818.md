# Adversary r3 synthesis — clipboard image paste impl (r2 nits fold)

**Date**: 2026-08-18  
**HEAD**: `ad48d6e` (`feat/clipboard-image-paste`)  
**Base**: `origin/main` (`7a88b8c`)  
**Worktree**: `.worktrees/feat-clipboard-image-paste`  
**Spec**: `docs/superpowers/specs/2026-08-17-clipboard-image-paste-design.md`  
**Blast**: T2

Independent lanes (explore, read-only, isolated from implementer session).

## r1 → r2 → r3

| ID | r1 | r2 | r3 |
|----|----|----|----|
| M1 thumbs | REJECT | closed | **still closed** — persist `preview_jpeg_b64` + ChatView `previewDataUrl` + `onError` empty tile |
| M2 ghost/chips | REJECT | closed | **still closed** — no optimistic user; chips only on `file.uploaded` bump |
| M3 dest host | REJECT | closed | **still closed** — `config_override.base_url`; destAck merge-on-hydrate |
| M4 tokens | REJECT | closed | **still closed** — numeric 1600; dims → 2800 reachable |
| M5 edit splice | REJECT | closed | **still closed** — `spliceEditedCaption` |
| M6 sidecar/HEIC | REJECT | closed | **still closed** — plan-then-write; MIME + basename refuse HEIC/SVG |

r2 named leftovers (2800 dims, companion WS_SOFT_MAX, `<untrusted-image>`, typeless `.heic`, dest-ack race, `previewDataUrl`, classifyDrop html/data/blob/file): **verified folded** by all three lanes.

## Lane r3

| Lane | VERDICT |
|------|---------|
| Product | APPROVE_WITH_NITS |
| Architecture | APPROVE_WITH_NITS |
| Security | APPROVE_WITH_NITS |

**ADVERSARY r3: APPROVE_WITH_NITS**

## MACHINE (this session, implementer — not a judge)

| Suite | Result |
|-------|--------|
| companion `tsc --noEmit` + `tsc -p tsconfig.test.json` | PASS `[executed]` |
| companion targeted (likely-multimodal, sniff, parts, preview, split-upload, sidecar, budget, adapter, anthropic, logger-redact) | **111 pass / 0 fail** `[executed]` |
| extension `tsc --noEmit` + `tsc -p tsconfig.test.json` | PASS `[executed]` |
| extension targeted (image-compose, vision-reuse, ws-frame-budget, sidepanel-state, composer-slash) | **76 pass / 0 fail** `[executed]` |
| `clipboardRead` in extension | none `[inspected]` |
| `MAX_WS_MESSAGE_SIZE` still 10MiB | yes `[inspected]` |
| `fetch` / `fetchImageAsBase64` on composer path | none `[inspected]` |

## Named leftovers (non-blocking)

1. Mixed HEIC+PNG: paste ignores non-allowlisted `item.type` (no banner); mixed drop can clear `fileError` after ingest (`App.tsx` addIncomingFiles). PNG+text survive.
2. Composer chips are text, not 48px blob thumbs (spec §3.2); transcript thumbs exist.
3. Transcript dest subtitle `📎 name · → host` not rendered (chip + first-send only).
4. `if (!written) return uploadError` mid-loop does not throw → catch orphan cleanup skips image-0 if image-1 write fails (`message-router.ts` sidecar loop).
5. Tray origin still allowed for `file.upload` after HMAC (pre-declared leftover).
6. `previewImageSafe` 300KB vs companion 8KB cap (still guarded).
7. `ChatCreateParams.imageAttachments` type omits `width`/`height` (runtime still persists).
8. Empty `File.type` paste fail-closed (some OS clips never attach).
9. Dest ack stamped even if later WS fails (retry will not re-show line).

## Capability

```text
Surface:      L0 (chat composer attachments — no new CDP/tool)
L2-classes:   (none)
Compose:      none
Autonomy:     single
Trust:        user-initiated image bytes → effective chat LLM (native)
              or config.vision (text-only). No new confirm dialect.
Channel:      community
```

## Dual r3 — 2026-08-18

| Judge | VERDICT |
|-------|---------|
| Pi | **APPROVE_WITH_NITS** — `…-impl-r3-pi-20260818-110845.md` (re-ran 111 + 76; confirmed M1–M6 closed; leftovers accurate not loose) |
| Claude | **UNKNOWN** — API 529 twice (`…-r3-claude-20260818-110845.md`, retry `…-claude-retry-20260818-111721.md`). Infra, not a content REJECT. |

Default confirm order (独立对抗 → Pi) is **APPROVE\***. Claude dual is optional supplement and did not complete.

## Eval gate card

**Blast**: T2  
**MACHINE**: PASS (companion 111 + extension 76 + tsc)  
**ADVERSARY r3**: APPROVE_WITH_NITS  
**PI_REREVIEW**: APPROVE_WITH_NITS  
**CLAUDE**: UNKNOWN (529)  
**MERGE**: **YES** under default 对抗→Pi 序. Implementer does not self-APPROVE. Retry Claude when the gateway is healthy if you want the optional dual line.

Nits remain named leftovers (not folded this round).
