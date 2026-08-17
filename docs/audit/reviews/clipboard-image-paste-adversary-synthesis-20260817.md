# Multi-adversarial synthesis — 对话框用户附图（粘贴/选/拖）

**Date**: 2026-08-17  
**Strawman**: `docs/decisions/clipboard-image-paste-strawman-2026-08-17.md`  
**Method**: 3 independent plan agents (Product / Security / Architecture) + orchestrator lock  
**Blast**: T2 (Surface L0 composer + adapter hydrate; no new tool / L2 / confirm dialect)

## Lane verdicts

| Lane | VERDICT | Blocking themes |
|------|---------|-----------------|
| Product/UX | **REJECT** | 📎-only history; OS screenshot 4MiB bounce; P0 copy becomes a lie; mixed-send ghost failures; edit/regen drops pixels; first native send has no destination honesty |
| Security | **REJECT** | Legal mixed send trips WS 10MB `maxPayload` (socket death); sidecar path escape (`rel` / symlink / fork / hard-delete); magic sniff vaporware; URI drop as IMAGE_FETCH bypass if implemented loosely |
| Architecture | **REJECT** | `fileContents` cannot carry images; Anthropic user-merge stringifies parts; hydrate missing so regenerate/rebuild go blind; 1600 tok/image dishonest for 4K; `likelyMultimodal` must be companion SoT |

Strawman as written is **not implementable**. Locked table below absorbs every blocking item. User conversation locks (sources / mixed-send / paste+picker+drop / native-if-multimodal) are **kept**.

## Locked decisions (implementer MUST)

| # | Decision |
|---|----------|
| U1 | Sources = all clipboard rasters (OS screenshot / web copy / Finder file) |
| U2 | Mixed send: empty composer → attach+wait; nonempty text → attach+send same tick (explicit file list, no stale `setState`) |
| U3 | Surface = paste + picker + drag-drop on InputArea |
| U4 | Routing = `likelyMultimodal(effective model)` → native main-loop parts; else vision rail. **Not** protocol-gated. Tool screenshot / `analyze_image` / PDF embeds **unchanged** (vision rail) |
| P1 | Transcript v1 **must** show a 48px thumb (composer-parity), not 📎-only. Full-size lightbox deferred. Clipboard names → `截图 YYYY-MM-DD HH:mm` |
| P2 | Client **recompress/downscale** before send (longest edge ≤ 1568, JPEG q≈0.85 unless already small PNG/GIF). Chip shows `已压缩` when bytes change. Typical Retina OS screenshot must succeed |
| P3 | Composer **preflight**: `!useNative && !vision.enabled` → do not send; banner + chips stay. Companion reject → restore chips, **no ghost user turn** |
| P4 | Edit / regenerate / fork of an image turn **keeps** sidecars. Edit is caption-only. `skipUserMessage` still hydrates |
| P5 | Destination honesty: chip + optimistic line always show hostname. First native send **per hostname** → one composer line (not L2). Persist ack in `chrome.storage.local`; `base_url` change re-prompts |
| P6 | Exact copy rewrite (Side Panel **and** settings-web) — see design §8. Never again claim “主对话不会直接收图” as universal |
| S1 | **Serialized UTF-8 JSON size** of the whole `file.upload` frame computed **before** `ws.send`. Refuse if `> 10MiB − 256KiB`. Do not raise `MAX_WS_MESSAGE_SIZE` |
| S2 | Joint budget: images + docs + envelope share the frame cap. Decoded image caps (4MiB/ea, 6MiB total **after** compress) are additional |
| S3 | Keep `selectedFiles` until `file.uploaded` / `file.upload_error` / disconnect. Client refuse must not clear chips |
| S4 | Magic sniff algorithm locked (PNG/JPEG/GIF/WEBP signatures). `sniffed === declared` or reject. Images **never** enter `allowed_types` / `parseFile` |
| S5 | Sidecar names **companion-chosen** only. `realpath` + `lstat` not symlink + `isStrictlyInside`. NEVER trust client `rel`/`sha256` as a load path. Hard-delete all paths remove `.files/`. Fork **copies bytes** + new names |
| S6 | NEVER fetch / `fetchImageAsBase64` / `analyze_image` from paste/drop. Reject uri-list / moz-url / html / 0-byte File / data: / blob: / file: URI |
| S7 | Thumbs = React `<img src={blob:}>` from sniffed raster only. No innerHTML / SVG / object / embed |
| S8 | NEVER log `content` / base64 / `image_url.url`. Log `byte_len` / sha256 / sniffed MIME |
| A1 | New `chatCreate.imageAttachments` (metadata). **Do not** overload `fileContents` |
| A2 | Exactly **one** user `addMessage` per send, inside `chatCreate`. Disk `content` stays string; `attachments?` is metadata |
| A3 | `hydrateUserImageParts` is the **only** injection of image parts, after `rebuildMessagesFromHistory`, before context budget. Rebuild pairing stays pure/string |
| A4 | Anthropic consecutive-user merge is **block-wise** and **stays** (omit-notice requires it) |
| A5 | `likelyMultimodal` SoT = `companion/src/llm/likely-multimodal.ts`. Denylist `kimi-k2` / `moonshot-v1*` unless `vl\|vision\|omni`. Extension/settings-web lockstep tests. Client cannot force native |
| A6 | Token: after P2 downscale (≤1568), estimate **1600 tok/image** is honest for high-detail tiles. `serializeMessage` / redact **must** handle parts (never `String(array)` / `.replace` on array). Title/summary/Obsidian never get pixels |
| A7 | Echo persisted `message_id` so optimistic row adopts disk id (regenerate/export) |
| A8 | Open questions closed: no `supports_vision` config in v1; GIF/WebP sent as-is; image+doc empty caption = `请查看附件`; worker/orchestrator same caps; `file_upload_max_size` slider does **not** raise image budget |

## Dual review (Claude + Pi) — 2026-08-17 16:12

| Judge | VERDICT | Note |
|-------|---------|------|
| Claude | **REJECT** | One blocker: vision-rail `analyzeImage` text had no persist/replay carrier |
| Pi | **APPROVE_WITH_NITS** | Preflight vs `enable_vision_analysis`; companion re-validate caps; name extension test file; 1600 tok under-counts squares |

**Folded into locked spec after dual (not re-reviewed in this batch):**

- §5.1a — vision description appended to disk `content` (`<!-- 用户附图分析 -->`); regenerate replays it
- Preflight uses `vision.enabled && enable_vision_analysis !== false`
- Companion re-validates 4 / 4MiB / 6MiB / frame JSON
- Sidecar only after LLM gates; `deleteMessagesFrom` cleans sidecars
- Token 1600 vs 2800 by aspect; ack keyed by hostname (incl. override)
- DoD #16 + extension test file named in §10

`both_approve=false` on the *pre-fold* spec.

## Dual review r2 — 2026-08-17 16:27

| Judge | VERDICT | Note |
|-------|---------|------|
| Claude | **APPROVE_WITH_NITS** | r1 8/8 closed; nits: step 3 vs 5 order, token bucket gap, Anthropic 3.3k |
| Pi | **APPROVE_WITH_NITS** | r1 8/8 closed; same step-order nit; ack key shape; Anthropic residual |
| both_approve | **true** | `clipboard-image-paste-design-r2-verdict-20260817-162716.json` |

Post-r2 nits folded into spec (not a new dual): §5.1 step order (sidecar after gates); §5.4 default +1600 + Anthropic residual named; §3.6 key `cmspark.imageDestAck.<hostname>`.

## Overall design gate

**APPROVE* for writing the implementation plan.**  
Design batch is not a code merge. Implementer still must not self-APPROVE the later impl batch.

Security/Product/Architecture REJECT was against the *strawman*. Locked table resolves those.

## Capability declaration

```text
Surface:      L0 (chat composer attachments — no new CDP/tool)
L2-classes:   (none)
Compose:      none (reuses file.upload + existing vision rail)
Autonomy:     single
Trust:        user-initiated image bytes → effective chat LLM (native)
              or config.vision (text-only). No new confirm dialect.
              Destination hostname disclosed on chip + first-send line.
Channel:      community
```

## Residual risks (named, accepted)

- Indirect prompt injection via pixels (same class as screenshot / analyze_image)
- Prefix-only magic: GIFAR / JPEG+HTML polyglot — accepted if thumbs are `<img>`-only
- Paired extension + stolen `ws_secret` can already `file.upload`; pixels raise blast to cloud LLM
- User pasting secrets (same as pasting a password as text); mixed-send raises accident rate — mitigated by destination-on-chip, not a new L2
- History replay re-sends up to 4 images until compacted
- Heuristic false-negative: user must rename model or enable vision (no override field in v1)

---

*Orchestrator synthesis · lanes were isolated · 2026-08-17*
