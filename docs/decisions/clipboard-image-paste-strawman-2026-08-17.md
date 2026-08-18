# Strawman — 对话框粘贴/选/拖图片（用户附图 · 原生多模态分流）

**Date**: 2026-08-17  
**Status**: STRAWMAN for multi-path adversary (not locked)  
**Blast**: T2 (Surface L0 composer + adapter message shape; no new tool / L2 / confirm dialect)  
**Related**: vision-reuse P0 (`docs/decisions/vision-reuse-main-llm-brief-2026-08-08.md`) · `vision-pipeline.ts` · `file.upload` · ADR-020

This is a **draft for independent lanes to attack**. Locked table comes after synthesis.

---

## 0. Capability declaration (ADR-020)

```text
Surface:      L0 (chat composer attachments — no new CDP/tool)
L2-classes:   (none)
Compose:      none (not a Pack / skill / MCP; reuses file.upload + vision rail)
Autonomy:     single
Trust:        user-initiated image bytes go to the effective chat LLM endpoint
              (native) or config.vision endpoint (text-only fallback).
              No new confirm dialect. No clipboardRead permission.
Channel:      community
```

**Not**: a new runtime, a new Side Panel chrome tab, native multimodal for *tool* screenshots, or Qwen3-VL CU locate.

---

## 1. Thesis

> Users can paste, pick, or drop raster images into the Side Panel composer.  
> If the **thread-effective main LLM is likely multimodal**, those user images ride in the **main chat turn** (OpenAI `image_url` / Anthropic image block).  
> If the main LLM is text-only (or unknown — fail closed), images go through the **existing vision side-pipeline** (`analyzeImage`).  
> Tool `screenshot` / page `analyze_image` / PDF embedded images are **out of scope** and stay on the vision rail.

**Non-thesis**

- Do not auto-fallback native → vision on API 400 (user locked “option 2”).
- Do not request `clipboardRead`.
- Do not fetch remote URLs dropped from a webpage (that is `analyze_image` + IMAGE_FETCH_GATE).
- Do not inject tool-screenshot pixels into the main loop.

---

## 2. Locked user choices (conversation)

| # | Choice |
|---|--------|
| Sources | All clipboard images: OS screenshot, web “copy image”, Finder/Explorer file copy |
| Send model | **Mixed**: empty composer → attach and wait; composer already has text → attach + send immediately |
| Input surface | Paste + file picker + drag-drop onto composer |
| Routing | Native multimodal when `likelyMultimodal(effective model)`; else vision config |

---

## 3. Problem / JTBD

| Actor | Pain | Desired |
|-------|------|---------|
| User with GPT-4o / Kimi / glm-4v / Claude Messages | Paste does nothing; or would be pre-described by a weaker/separate VLM | Main model *sees* the screenshot they just took |
| User with DeepSeek / llama3.1 | No native vision | Same paste UX; vision rail describes, then main reads text |
| User who configured a cheap local VLM + strong text model | Must not lose that split | Text-only main → still uses `config.vision` |
| User who clicked「使用主模型」for screenshots | Settings reuse ≠ native chat | Screenshots stay pre-analyze; *user paste* is a different rail |

---

## 4. As-is (inspected)

- Composer `InputArea` (`chrome-extension/src/sidepanel/App.tsx`): file picker `accept` is documents only; **no `onPaste` / `onDrop`**.
- `file.upload` → `parseFile` **rejects** `image/*`; `allowed_types` has no image MIME.
- Vision is a **side-pipeline**: `analyzeImage` → text. Main `CanonicalChatMessage` user content is `string` only.
- Vision-reuse P0 copies credentials into `config.vision`; **explicitly did not** put `image_url` in the agent loop (P2 deferred).
- `likelyMultimodal` exists and is tested (fail-closed unknown → false). `shouldOfferVisionReuse` additionally blocks `protocol=anthropic`.
- WS `maxPayload` = **10MB** (`companion/src/ws/lifecycle.ts`). Base64 inflates ×4/3. A 6MB decoded image is ~8MB on the wire — one image can saturate the frame.
- `file.upload` validate: max **10 files**, requires name/type/content strings.
- Thread messages live in `~/.cmspark-agent/threads/<id>.json` (`content: string`). No attachment sidecar today.
- Anthropic convert (`anthropic-convert.ts`) treats user content as a string and merges consecutive user turns as text.

---

## 5. Proposed design (attack this)

### 5.1 Routing (send time)

```
effectiveModel = thread.config_override.model_name || config.llm.model_name
useNative = likelyMultimodal(effectiveModel)   // NOT gated on protocol
```

| Case | Images | Docs |
|------|--------|------|
| `useNative` | parts on user turn; **do not** call `config.vision` | existing parse → `<document>` text |
| `!useNative` && vision.enabled && file_upload.enable_vision_analysis | `analyzeImage` per image; text injected | unchanged |
| `!useNative` && vision off | **fail the send** (do not drop images silently) | n/a if only images |

Anthropic Messages + Claude: **native** (Messages supports images). This is *not* the vision-reuse CTA (that stays blocked for Anthropic).

Heuristic false-positive (name looks multimodal, endpoint rejects images): surface the provider error; **no silent fallback** to vision.

### 5.2 Composer UX

- `onPaste` on textarea (and composer chrome): if any `clipboardData.items` is `image/*` allowlisted, `preventDefault`, add to `selectedFiles`. Do **not** also paste accompanying `text/html` / URL junk. Keep already-typed textarea text.
- `onDrop` / `onDragOver` on the InputArea root: highlight; accept `DataTransfer.files` that are allowlisted images or existing document types. Reject `text/uri-list` / http(s) URL drops (no fetch).
- File picker `accept` adds `.png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp`.
- Preview: image → thumbnail chip (max ~48px, 320px panel); docs stay text chips. Remove = ×.
- Mixed send: if `text.trim()` nonempty at paste/drop of an image, attach then `handleSend` **with the new file list in the same tick** (do not rely on `setState` then `handleSend` — React stale state).
- Empty text + Send with only images: default caption `请看这张图` / `请看这些图片`.
- Disabled composer (no thread / disconnected / threadBusy / voice overlay): ignore paste/drop of files; show existing disabled affordance.

### 5.3 Limits (must fit WS 10MB)

| Limit | Strawman value | Why |
|-------|----------------|-----|
| MIME | png / jpeg / gif / webp only | lock-step with `ALLOWED_IMAGE_MIMES_LIST`; reject HEIC / SVG / BMP / TIFF with explicit copy |
| Magic bytes | companion sniffs signature; MIME spoof → reject | defense in depth |
| Per-image decoded | **4 MiB** | 4×4/3 ≈ 5.3MB b64; headroom under 10MB |
| Per-send decoded total (all images) | **6 MiB** | whole `file.upload` JSON must stay < 10MB |
| Count | max **4** images per send | UX + token |
| Documents | existing 10MB / 10 files rules unchanged | mixed send: images count toward 6MiB image budget; docs toward file size |

### 5.4 Persistence

- Thread JSON `content` stays human text (`user text` + `📎 name`). **No base64 in `threads/<id>.json`.**
- Sidecar: `~/.cmspark-agent/threads/<id>.files/<msgId>-<n>.<ext>` mode `0o600`. Containment: thread id already `^[a-zA-Z0-9_-]{1,64}$`.
- Message field: `attachments?: { kind:"image", name, mime, sha256, bytes, rel }[]`
- Thread hard-delete / cleanup: delete `<id>.files/` with the json.
- Soft-trash: keep sidecars (restore must still see images).

### 5.5 Canonical / providers

Extend:

```ts
type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: `data:${mime};base64,...` } }

CanonicalChatMessage user.content: string | UserContentPart[]
```

- OpenAI provider: pass through (SDK already accepts parts).
- Anthropic convert: map data-URL parts → `{ type:"image", source:{ type:"base64", media_type, data } }`. Consecutive user-turn merge must **not** stringify image parts away.
- Same `chatCreate` / tool-loop in-memory messages **keep** image parts for the whole request (「看这张图点红按钮」).

### 5.6 History replay

- `rebuildMessagesFromHistory`: if message has image attachments **and** current `useNative`, load sidecar → parts. If file missing, stub `[图片丢失: name]`.
- If current model is **not** multimodal (user switched thread model to DeepSeek): **strip** image parts; keep text stub. Do not 400 the text-only endpoint.
- Wire cap: newest **4** images across the compacted window; older → `[图片: name]`.
- Token estimate: **1600 tokens / image** in context budget so compaction actually drops old image turns.
- Compaction / title / summary / Obsidian export: text stub only (no pixels). Export may mention `📎 name`.

### 5.7 Protocol

Reuse `file.upload` (no new WS type). Companion splits `files[]` by MIME:

- image → native or vision
- other → `parseFile`

Extension `FileAttachment` unchanged (`name, type, size, content` base64).

Optimistic UI message (`📎 names`) stays; companion still `addMessage` as today for documents. **Adversaries: check double-user-message / dedup.**

### 5.8 Settings / honesty copy

- Vision section help must distinguish:
  - **用户附图**（粘贴/选/拖）→ 主模型能看图则直送主模型；否则走视觉轨
  - **截图 / analyze_image** → 仍先视觉轨转文字（P0 reuse 不变）
- When native path is used, do **not** require `vision.enabled`.
- Privacy: user images go to `llm.base_url` hostname (native) or `vision.base_url` (fallback). No extra toast required if settings already show those hosts; error/status should name the destination on failure.

### 5.9 Errors (user-visible)

| Situation | Copy (zh) |
|-----------|-----------|
| Unsupported type / HEIC | 不支持该图片格式（请使用 PNG / JPEG / GIF / WebP） |
| Over per-image or total size | 图片过大（单张 ≤4MB，合计 ≤6MB） |
| SVG / URI drop | 不能从网页链接拉图；请复制图片本身或改用截图 |
| Text-only + vision off | 当前主模型不能看图。请在设置中开启「视觉分析」并配置视觉模型 |
| Native endpoint rejects image | 主模型拒绝了图片（{provider error}）。可换多模态模型，或改用文本模型并开启视觉分析 |
| Sidecar missing on replay | [图片丢失: name] |
| Magic-byte mismatch | 文件内容与类型不符，已拒绝 |

### 5.10 Out of scope (v1)

- HEIC decode / convert
- Native multimodal for tool screenshots / PDF embeds
- Auto-fallback native→vision
- `clipboardRead` / reading clipboard without paste
- Rendering full-size image in the transcript (thumbnail in composer only; history shows `📎`)
- New confirm / L2
- Changing `MAX_WS_MESSAGE_SIZE`

---

## 6. Risks for adversaries

1. WS 10MB vs 4×4MB images (even with 6MB total — is 6MB total still too tight with JSON/docs?)
2. Heuristic false positive / false negative (`kimi-k2` is marked multimodal — is that true?)
3. Thread model switch mid-history
4. Anthropic consecutive-user merge dropping images
5. Double user message (extension optimistic + companion addMessage)
6. Sidecar path escape / leftover files after hard-delete
7. Prompt injection via pasted screenshot of “ignore previous instructions”
8. SVG/HTML polyglot if we ever render thumbs as img src=blob (XSS)
9. Voice overlay + paste race
10. Worker / multi-agent threads receiving huge images
11. Settings copy still saying “主对话不会直接收图” after this ships (lie)
12. Regenerating a turn that had images (`skipUserMessage`)
13. `file.upload` + native path still running vision on mixed PDF embeds (OK) vs standalone PNG (must not)
14. Privacy: clipboard screenshots of other apps (password managers) sent to cloud LLM with no extra confirm
15. Context budget 1600 tok/image under/over estimate → silent overflow or over-drop

---

## 7. External DoD (machine-observable, post-impl)

1. Extension: paste/drop/picker accept allowlisted images; reject others with copy
2. Mixed send: nonempty text + paste image → one send, no stale `selectedFiles`
3. Companion: `likelyMultimodal` true → no `analyzeImage` call for standalone images (unit/spy)
4. Companion: `likelyMultimodal` false + vision off → `file.upload_error` (not silent drop)
5. Magic-byte reject; HEIC reject
6. Anthropic convert emits image blocks; consecutive user merge preserves them
7. `rebuildMessagesFromHistory` strips images when current model is text-only
8. Sidecar 0o600; thread delete removes `.files/`
9. Upload payload >10MB never reaches handler (existing WS gate) + client-side total 6MiB
10. No `clipboardRead` in manifest
11. Settings help no longer claims “主对话不会直接收图” as a universal truth
12. Tool screenshot / analyze_image tests unchanged (no native injection)

---

## 8. Eval gate card (design stage)

**Blast tier**: T2  
**Capability**: see §0  
**Judges**: 3 independent lanes (Product / Security / Architecture) → synthesis → Claude+Pi dual review of the **locked design** (no impl in this batch)

---

*Strawman only — do not implement from this file.*
