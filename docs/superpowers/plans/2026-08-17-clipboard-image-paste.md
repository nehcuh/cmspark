# Clipboard Image Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can paste, pick, or drop raster images into the Side Panel composer; a multimodal main LLM sees the pixels natively, a text-only model uses the existing vision rail, and tool screenshots stay on the vision rail.

**Architecture:** Reuse `file.upload`. Companion MIME-splits images before `allowed_types`/`parseFile`. Disk messages stay strings plus attachment metadata; pixels live in `threads/<id>.files/`. `hydrateUserImageParts` is the only place image parts enter `CanonicalChatMessage`, after `rebuildMessagesFromHistory`. Routing is `likelyMultimodal(effective.model_name)` in companion (not protocol-gated).

**Tech Stack:** Chrome extension (Plasmo/React) · Companion Node 20 + TypeScript · `node:test` · existing OpenAI / Anthropic providers · no new WS type · no `clipboardRead`.

**Spec SoT:** `docs/superpowers/specs/2026-08-17-clipboard-image-paste-design.md`  
**Design gate:** Claude+Pi r2 both `APPROVE_WITH_NITS` (`docs/audit/reviews/clipboard-image-paste-design-r2-verdict-20260817-162716.json`). This plan is not a code merge license — impl still needs machine + adversary + dual.

**Do not:** raise `MAX_WS_MESSAGE_SIZE`; overload `fileContents` with PNG base64; put hydrate inside `rebuildMessagesFromHistory`; fetch URLs from drop; implement HEIC; change screenshot / `analyze_image` / PDF-embed rails.

---

## File map

| File | Responsibility |
|------|----------------|
| Create `companion/src/llm/likely-multimodal.ts` | SoT heuristic + denylist |
| Create `companion/tests/likely-multimodal.test.ts` | Lockstep vectors |
| Modify `chrome-extension/src/sidepanel/components/vision-reuse-logic.ts` | Mirror SoT + §8 copy |
| Modify `chrome-extension/tests/vision-reuse-logic.test.ts` | Flip kimi-k2 / moonshot-v1 |
| Create `companion/src/llm/image-sniff.ts` | Magic-byte sniff |
| Create `companion/tests/image-sniff.test.ts` | Signature matrix |
| Create `companion/src/llm/image-parts.ts` | hydrate / token / stubs |
| Create `companion/tests/image-parts.test.ts` | Native vs strip vs cap |
| Modify `companion/src/llm/provider.ts` | `user.content: string \| UserContentPart[]` |
| Modify `companion/src/llm/context-budget.ts` | serialize / redact / estimate |
| Modify `companion/src/llm/providers/anthropic-convert.ts` | Block-wise user merge + image blocks |
| Modify `companion/tests/llm-provider-anthropic.test.ts` | Image merge case |
| Modify `companion/src/threads/thread-manager.ts` | `attachments`, sidecar CRUD, delete/fork/trim |
| Create `companion/tests/thread-image-sidecar.test.ts` | Containment + delete |
| Modify `companion/src/llm/adapter.ts` | `imageAttachments`, one addMessage, hydrate after rebuild |
| Modify `companion/src/message-router.ts` | MIME split, vision §5.1a, echo `message_id` |
| Modify `companion/src/logger.ts` | Redact `content` / `base64` / `image_url` |
| Create `chrome-extension/src/sidepanel/utils/image-compose.ts` | Classify paste, size preflight, compress decision |
| Create `chrome-extension/tests/image-compose.test.ts` | Pure helpers |
| Modify `chrome-extension/src/sidepanel/App.tsx` | paste/drop/picker/preflight/mixed-send |
| Modify `chrome-extension/src/sidepanel/types.ts` | `attachments` on Message |
| Modify `chrome-extension/src/sidepanel/components/ChatView.tsx` | 48px thumb, caption-only edit |
| Modify `chrome-extension/src/background/index.ts` | Refuse frame ≥ 10MiB−256KiB |
| Modify `companion/src/settings-web.ts` | Honesty copy |
| Modify `chrome-extension/src/sidepanel/utils/meta-slash.ts` | Placeholder |

---

### Task 1: `likelyMultimodal` companion SoT + denylist

**Files:**
- Create: `companion/src/llm/likely-multimodal.ts`
- Create: `companion/tests/likely-multimodal.test.ts`
- Modify: `chrome-extension/src/sidepanel/components/vision-reuse-logic.ts`
- Modify: `chrome-extension/tests/vision-reuse-logic.test.ts`

- [ ] **Step 1: Write companion failing tests**

```ts
// companion/tests/likely-multimodal.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { likelyMultimodal } from "../src/llm/likely-multimodal"

test("likelyMultimodal: known multimodal families true", () => {
  for (const m of [
    "gpt-4o", "gpt-4.1", "gpt-4-turbo", "claude-sonnet-4-6", "claude-opus-4-7",
    "gemini-2.0-flash", "glm-4v", "glm-4.6v", "qwen2.5-vl", "qwen2.5vl:3b",
    "llava:7b", "pixtral-12b", "foo-vision-bar", "kimi-vl", "moonshot-v1-vision",
  ]) {
    assert.equal(likelyMultimodal(m), true, m)
  }
})

test("likelyMultimodal: text-only and unknown false (fail closed)", () => {
  for (const m of [
    "deepseek-chat", "deepseek-v4-flash", "kimi-k2", "moonshot-v1-128k",
    "my-coder-7b", "some-reasoner", "", "foo-bar-7b", "llama3.1",
  ]) {
    assert.equal(likelyMultimodal(m), false, m)
  }
})
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
cd companion && npx tsc -p tsconfig.test.json --pretty false 2>&1 | head
```

Expected: cannot find `likely-multimodal`.

- [ ] **Step 3: Implement SoT (copy current heuristic, insert denylist BEFORE `/kimi|moonshot/`)**

```ts
// companion/src/llm/likely-multimodal.ts
/** Fail-closed name heuristic. Does NOT read protocol. */
export function likelyMultimodal(modelName: string | undefined | null): boolean {
  const m = (modelName || "").trim().toLowerCase()
  if (!m) return false
  if (/deepseek/.test(m)) return false
  if (/\br1\b/.test(m) && !/vision|vl/.test(m)) return false
  if (/(^|[-_])(coder|reasoner)($|[-_])/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/kimi-k2/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/moonshot-v1/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|o[1-9].*vision|chatgpt-4o/.test(m)) return true
  if (/claude|sonnet|opus|haiku/.test(m)) return true
  if (/gemini|gemma.*vision/.test(m)) return true
  if (/kimi|moonshot/.test(m)) return true
  if (/glm-4v|glm-4\.?\d*v|glm-4\.6v/.test(m)) return true
  if (/qwen.*vl|vl.*qwen|qwen2\.5-?vl|qwen2-vl|qwen3-vl/.test(m)) return true
  if (/llava|minicpm-v|moondream|pixtral|phi-3-vision|phi-4-multimodal/.test(m)) return true
  if (/\bvision\b|multimodal|omni/.test(m)) return true
  return false
}
```

Mirror the same function body into `vision-reuse-logic.ts` `likelyMultimodal` (extension cannot import companion). Add comment: `// lock-step companion/src/llm/likely-multimodal.ts`.

In `vision-reuse-logic.test.ts` include list: **remove** `kimi-k2` and `moonshot-v1-128k`. Exclude list: **add** those two. Add `kimi-vl` to include if you want the denylist exception covered on the extension side.

- [ ] **Step 4: Run tests**

```bash
cd companion && npm test -- --test-name-pattern 'likelyMultimodal'
cd ../chrome-extension && npm test -- --test-name-pattern 'likelyMultimodal'
```

Expected: PASS. DoD #15.

- [ ] **Step 5: Commit**

```bash
git add companion/src/llm/likely-multimodal.ts companion/tests/likely-multimodal.test.ts \
  chrome-extension/src/sidepanel/components/vision-reuse-logic.ts \
  chrome-extension/tests/vision-reuse-logic.test.ts
git commit -m "feat(vision): companion likelyMultimodal SoT; deny kimi-k2 / moonshot-v1"
```

---

### Task 2: Magic-byte sniff

**Files:**
- Create: `companion/src/llm/image-sniff.ts`
- Create: `companion/tests/image-sniff.test.ts`

Reuse `normalizeImageMime` from `companion/src/image-data-url.ts`. Do **not** reuse `file-parser.ts` `IMAGE_FORMATS` (contains svg/bmp/tiff).

- [ ] **Step 1: Write failing tests**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { sniffRasterImage, admitComposerImage } from "../src/llm/image-sniff"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
const WEBP = Buffer.from(Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"),
]))
const WAVE = Buffer.from(Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE"),
]))

test("sniffRasterImage: png/jpeg/gif/webp", () => {
  assert.equal(sniffRasterImage(PNG), "image/png")
  assert.equal(sniffRasterImage(JPEG), "image/jpeg")
  assert.equal(sniffRasterImage(GIF), "image/gif")
  assert.equal(sniffRasterImage(WEBP), "image/webp")
  assert.equal(sniffRasterImage(WAVE), null)
  assert.equal(sniffRasterImage(Buffer.from("not-an-image")), null)
})

test("admitComposerImage: sniffed must equal declared", () => {
  assert.deepEqual(admitComposerImage(PNG, "image/png"), { ok: true, mime: "image/png" })
  assert.equal(admitComposerImage(PNG, "image/jpeg").ok, false)
  assert.equal(admitComposerImage(PNG, "image/heic").ok, false)
  assert.equal(admitComposerImage(PNG, "image/svg+xml").ok, false)
  assert.equal(admitComposerImage(Buffer.from("<html>"), "image/png").ok, false)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd companion && npm test -- --test-name-pattern 'sniffRasterImage|admitComposerImage'
```

- [ ] **Step 3: Implement**

```ts
// companion/src/llm/image-sniff.ts
import { normalizeImageMime } from "../image-data-url"

export type RasterMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp"

export function sniffRasterImage(buf: Buffer): RasterMime | null {
  if (buf.length < 12) return null
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png"
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return "image/gif"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp"
  return null
}

export function admitComposerImage(
  buf: Buffer,
  declaredType: string | undefined | null,
): { ok: true; mime: RasterMime } | { ok: false; error: string } {
  const sniffed = sniffRasterImage(buf)
  if (!sniffed) return { ok: false, error: "文件内容与类型不符，已拒绝" }
  const declared = normalizeImageMime(declaredType)
  if (!declared) return { ok: false, error: "不支持该图片格式（请使用 PNG / JPEG / GIF / WebP）" }
  if (sniffed !== declared) return { ok: false, error: "文件内容与类型不符，已拒绝" }
  return { ok: true, mime: sniffed }
}

export function sniffedExt(mime: RasterMime): "png" | "jpg" | "gif" | "webp" {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  if (mime === "image/gif") return "gif"
  return "webp"
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(vision): sniff composer raster images; reject MIME spoof`

---

### Task 3: Hydrate + token estimate (pure)

**Files:**
- Create: `companion/src/llm/image-parts.ts`
- Create: `companion/tests/image-parts.test.ts`
- Modify: `companion/src/llm/provider.ts` (`CanonicalChatMessage` user content)

- [ ] **Step 1: Widen the type first (needed by tests)**

In `provider.ts` replace the user variant:

```ts
export type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export type CanonicalChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | UserContentPart[] }
  | { /* assistant unchanged */ }
  | { /* tool unchanged */ }
```

Existing string user messages stay valid.

- [ ] **Step 2: Write hydrate tests**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { estimateImagePartTokens, hydrateUserImageParts } from "../src/llm/image-parts"

const att = {
  kind: "image" as const,
  name: "截图 2026-08-17 15:58",
  mime: "image/png" as const,
  sha256: "abc",
  bytes: 100,
}

test("estimateImagePartTokens: default 1600; square 2800", () => {
  assert.equal(estimateImagePartTokens(), 1600)
  assert.equal(estimateImagePartTokens(1920, 1080), 1600)
  assert.equal(estimateImagePartTokens(1300, 1000), 1600)
  assert.equal(estimateImagePartTokens(1568, 1568), 2800)
})

test("hydrate: native loads parts newest-4; text-only strips", () => {
  const rebuilt = [
    { role: "user" as const, content: "a\n📎 one" },
    { role: "assistant" as const, content: "ok" },
    { role: "user" as const, content: "b\n📎 two" },
  ]
  const persisted = [
    { role: "user", content: "a\n📎 one", attachments: [{ ...att, name: "one", sha256: "1" }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: "b\n📎 two", attachments: [{ ...att, name: "two", sha256: "2" }] },
  ]
  const readImage = (a: typeof att) => ({ base64: `b64-${a.sha256}`, mime: a.mime })

  const native = hydrateUserImageParts(rebuilt, persisted, { useNative: true, maxImages: 4, readImage })
  const last = native[2]
  assert.equal(last.role, "user")
  assert.ok(Array.isArray(last.content))
  assert.equal((last.content as any[]).some((p) => p.type === "image_url"), true)

  const stripped = hydrateUserImageParts(rebuilt, persisted, { useNative: false, maxImages: 4, readImage })
  assert.equal(typeof stripped[2].content, "string")
  assert.match(String(stripped[2].content), /📎/)
})

test("hydrate: missing sidecar → 图片丢失 stub", () => {
  const rebuilt = [{ role: "user" as const, content: "x\n📎 gone" }]
  const persisted = [{ role: "user", content: "x\n📎 gone", attachments: [att] }]
  const out = hydrateUserImageParts(rebuilt, persisted, {
    useNative: true, maxImages: 4, readImage: () => null,
  })
  assert.match(JSON.stringify(out[0].content), /图片丢失/)
})
```

- [ ] **Step 3: Implement `image-parts.ts`**

```ts
import type { CanonicalChatMessage, UserContentPart } from "./provider"

export interface ImageAttachmentMeta {
  kind: "image"
  name: string
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  sha256: string
  bytes: number
  preview_jpeg_b64?: string
  width?: number
  height?: number
}

export function estimateImagePartTokens(width?: number, height?: number): number {
  if (width && height && width > 0 && height > 0) {
    const short = Math.min(width, height)
    const long = Math.max(width, height)
    const aspect = long / short
    if (aspect <= 1.3 && short >= 1200) return 2800
  }
  return 1600
}

export function userContentToText(content: string | UserContentPart[] | undefined | null): string {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.map((p) => (p.type === "text" ? p.text : `[图片]`)).join("\n")
}

export function hydrateUserImageParts(
  rebuilt: CanonicalChatMessage[],
  persisted: Array<{ role: string; content?: string | null; attachments?: ImageAttachmentMeta[] }>,
  opts: {
    useNative: boolean
    maxImages: number
    readImage: (att: ImageAttachmentMeta) => { base64: string; mime: string } | null
  },
): CanonicalChatMessage[] {
  const userIdx: number[] = []
  rebuilt.forEach((m, i) => { if (m.role === "user") userIdx.push(i) })
  const persistedUsers = persisted.filter((m) => m.role === "user")

  type Slot = { rebuiltIndex: number; att: ImageAttachmentMeta }
  const slots: Slot[] = []
  userIdx.forEach((ri, ui) => {
    const atts = persistedUsers[ui]?.attachments || []
    for (const att of atts) {
      if (att.kind === "image") slots.push({ rebuiltIndex: ri, att })
    }
  })

  const keep = new Set<ImageAttachmentMeta>()
  if (opts.useNative) {
    const newest = slots.slice(-opts.maxImages)
    for (const s of newest) keep.add(s.att)
  }

  const out = rebuilt.map((m) => ({ ...m })) as CanonicalChatMessage[]
  userIdx.forEach((ri, ui) => {
    const p = persistedUsers[ui]
    const atts = p?.attachments || []
    if (!atts.length) return
    const baseText = typeof out[ri].content === "string"
      ? (out[ri] as { role: "user"; content: string }).content
      : userContentToText((out[ri] as { role: "user"; content: string | UserContentPart[] }).content)

    if (!opts.useNative) {
      ;(out[ri] as { role: "user"; content: string }).content = baseText
      return
    }

    const parts: UserContentPart[] = [{ type: "text", text: baseText }]
    for (const att of atts) {
      if (!keep.has(att)) {
        parts.push({ type: "text", text: `\n[图片: ${att.name}]` })
        continue
      }
      const loaded = opts.readImage(att)
      if (!loaded) {
        parts.push({ type: "text", text: `\n[图片丢失: ${att.name}]` })
        continue
      }
      parts.push({
        type: "image_url",
        image_url: { url: `data:${loaded.mime};base64,${loaded.base64}` },
      })
    }
    ;(out[ri] as { role: "user"; content: UserContentPart[] }).content = parts
  })
  return out
}
```

- [ ] **Step 4: Run `npm test -- --test-name-pattern 'hydrate|estimateImagePartTokens'` — PASS**

- [ ] **Step 5: Commit** `feat(llm): hydrate user image parts after history rebuild`

---

### Task 4: Context budget + Anthropic block merge

**Files:**
- Modify: `companion/src/llm/context-budget.ts`
- Modify: `companion/src/llm/providers/anthropic-convert.ts`
- Modify: `companion/tests/llm-provider-anthropic.test.ts`
- Modify: `companion/tests/context-budget.test.ts` (add parts cases; existing string cases must still pass)

- [ ] **Step 1: Failing Anthropic test**

```ts
test("convertMessagesToAnthropic: merges omit notice + image user as blocks", () => {
  const { messages } = convertMessagesToAnthropic([
    { role: "system", content: "sys" },
    { role: "user", content: "[context_omitted] Earlier 3 messages omitted." },
    {
      role: "user",
      content: [
        { type: "text", text: "请看这张图" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    },
  ])
  assert.equal(messages.length, 1)
  assert.ok(Array.isArray(messages[0].content))
  const blocks = messages[0].content as any[]
  assert.ok(blocks.some((b) => b.type === "text" && /context_omitted/.test(b.text)))
  assert.ok(blocks.some((b) => b.type === "text" && /请看这张图/.test(b.text)))
  const img = blocks.find((b) => b.type === "image")
  assert.equal(img.source.type, "base64")
  assert.equal(img.source.media_type, "image/png")
  assert.equal(img.source.data, "AAA")
})
```

- [ ] **Step 2: Run — expect FAIL** (`String(parts)` / no image block)

- [ ] **Step 3: Implement**

Add to `AnthropicContentBlock`:

```ts
| { type: "image"; source: { type: "base64"; media_type: string; data: string } }
```

Replace the user-merge branch in `convertMessagesToAnthropic` so it accumulates blocks:

- string content → `{ type: "text", text }`
- `UserContentPart[]` → text parts as text; `image_url` data URLs only (`data:<mime>;base64,<data>`). Reject `http(s)` (skip that part, do not fetch).
- Consecutive users concatenate blocks, then emit one `{ role: "user", content: blocks }`.
- If the merged result is a single text block, you MAY still emit `content: string` for the existing omit-notice test (`assert.match(String(messages[0].content), …)`). **If any image block is present, content MUST be the block array.** Keep the existing string-only merge test green by: when every block is text, join with `\n\n` as today.

`serializeMessage` in `context-budget.ts`:

```ts
import { estimateImagePartTokens, userContentToText } from "./image-parts"

// in serializeMessage, user/system path:
if (m.role === "user" && Array.isArray(m.content)) {
  let s = ""
  for (const p of m.content) {
    if (p.type === "text") s += p.text
    else s += `[image:${estimateImagePartTokens()}]`
  }
  return s
}
```

Better: count tokens in `estimateMessagesTokens` by walking parts (text via `estimateTokens`, image via `estimateImagePartTokens` using optional width/height if we later stash them; v1 no width → 1600). Do **not** `String(array)`.

`redactMessagesForCompaction` user branch:

```ts
if (m.role === "user") {
  const text = typeof m.content === "string" ? m.content : userContentToText(m.content)
  return { role: "user", content: scrubSecretPatterns(text || "").slice(0, 800) }
}
```

Never `.replace` on an array.

- [ ] **Step 4: Run**

```bash
cd companion && npm test -- --test-name-pattern 'convertMessagesToAnthropic|serializeMessage|redactMessages'
```

Expected: existing merge test + new image merge + budget tests PASS.

- [ ] **Step 5: Commit** `fix(llm): Anthropic block-merge images; budget must not stringify parts`

---

### Task 5: Sidecar I/O + Message.attachments

**Files:**
- Modify: `companion/src/threads/thread-manager.ts`
- Create: `companion/tests/thread-image-sidecar.test.ts`

Use a test `DATA_DIR` / `getConfigDir` override if tests already stub it. Follow `companion/tests/` patterns for temp dirs (`fs.mkdtempSync`).

- [ ] **Step 1: Write containment / lifecycle tests**

Cover:

1. `writeImageSidecar(threadId, msgId, index, mime, buf)` writes `threads/<id>.files/<msgId>-<n>.<ext>` mode `0o600`, dir `0o700`.
2. `readImageSidecar` returns bytes; forged `rel` with `../` returns null.
3. `delete(threadId)` removes `.files/` (lstat: if symlink, refuse — do not `rmSync`).
4. `deleteMessagesFrom` deletes sidecars for removed messages.
5. Message-cap trim deletes sidecars of dropped rows.
6. Soft-trash does **not** delete `.files/`.

- [ ] **Step 2: Run — FAIL (methods missing)**

- [ ] **Step 3: Implement**

Add to `Message`:

```ts
attachments?: import("../llm/image-parts").ImageAttachmentMeta[]
```

Helpers (same file or `companion/src/threads/image-sidecar.ts` if `thread-manager.ts` is already huge — prefer **new file** `image-sidecar.ts` imported by ThreadManager):

```ts
export function attachmentsDir(configDir: string, threadId: string): string {
  // threadId already assertSafeThreadId
  return path.join(path.resolve(configDir, "threads"), `${threadId}.files`)
}
```

Containment: `realpath` of file must be strictly inside `realpath(dir)`; `lstat` dir is directory and not symlink (copy `isStrictlyInside` from `vault-templates.ts` — import it, do not fork unless import is circular).

`addMessage`: persist `attachments` if provided.

`delete` / `purgeExpiredTrash` / `cleanupEmpty`: after unlinking json, `removeAttachmentsDir(threadId)`.

`deleteMessagesFrom`: before slice, collect attachments of removed messages and unlink those files.

Cap trim (`slice(-MAX_MESSAGES_PER_THREAD)`): same unlink for dropped prefix.

Never trust client `rel` / `sha256` as a path. Load = companion-chosen `${msgId}-${n}.${ext}` only.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** `feat(threads): image sidecar dir with realpath containment`

---

### Task 6: `chatCreate.imageAttachments` + hydrate after rebuild

**Files:**
- Modify: `companion/src/llm/adapter.ts`
- Modify: `companion/tests/adapter.test.ts` (rebuild stays string-only; add a unit test that `rebuildMessagesFromHistory` still ignores attachments — pairing purity)

- [ ] **Step 1: Extend `ChatCreateParams`**

```ts
imageAttachments?: Array<{
  name: string
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  sha256: string
  bytes: number
}>
```

- [ ] **Step 2: Persist once**

In the `if (!skipUserMessage)` block, after building `userContent` from `message` + optional `<document>` tags (docs only):

```ts
const displayNames = [
  ...(fileContents || []).map((f) => f.filename),
  ...(imageAttachments || []).map((a) => a.name),
]
if (displayNames.length) {
  userContent = `${userContent}\n📎 ${displayNames.join(", ")}`
}
const msg = threadManager.addMessage(threadId, {
  thread_id: threadId,
  role: "user",
  content: userContent,
  attachments: imageAttachments?.map((a) => ({ kind: "image" as const, ...a })),
})
sendToExtension({
  type: "chat.user",
  thread_id: threadId,
  message_id: msg.id,
  content: userContent,
  attachments: msg.attachments,
})
```

If `imageAttachments` is set, ThreadManager must already have written sidecar **before** `chatCreate` (router Task 7) and generated `preview_jpeg_b64` there. `addMessage` only stores metadata.

- [ ] **Step 3: Hydrate after rebuild**

Immediately after `messages.push(...rebuildMessagesFromHistory(history))`:

```ts
const { likelyMultimodal } = require("./likely-multimodal")
const useNative = likelyMultimodal(config.model_name)
const persisted = threadManager.getMessages(threadId)
messages = [
  ...messages.filter((m) => m.role === "system"),
  ...hydrateUserImageParts(
    messages.filter((m) => m.role !== "system"),
    persisted,
    {
      useNative,
      maxImages: 4,
      readImage: (att) => threadManager.readImageAttachment(threadId, att),
    },
  ),
]
```

Keep a single system message at the front. Do **not** put I/O in `rebuildMessagesFromHistory`.

`skipUserMessage: true` uses the same hydrate path (no second addMessage).

- [ ] **Step 4: Run adapter + rebuild tests — PASS** (string histories unchanged)

- [ ] **Step 5: Commit** `feat(llm): persist image metadata and hydrate on every chatCreate`

---

### Task 7: `file.upload` MIME split + vision §5.1a

**Files:**
- Modify: `companion/src/message-router.ts` (`case "file.upload"`)
- Modify: `companion/src/logger.ts` (`SENSITIVE_KEY_RE` add `base64|image_url|^content$`)
- Create: `companion/tests/file-upload-images.test.ts` (router-level if existing harness exists; otherwise unit the split helper)

Extract a pure helper so tests do not boot the whole router:

```ts
// companion/src/llm/split-upload-files.ts
export function partitionUploadFiles(files: Array<{ name: string; type: string; content: string }>): {
  images: Array<{ name: string; type: string; buf: Buffer }>
  docs: Array<{ name: string; type: string; content: string }>
  error?: string
}
```

Images: `normalizeImageMime(type)` non-null → decode + `admitComposerImage`. Docs: everything else (still subject to `allowed_types` later).

- [ ] **Step 1: Tests for partition + caps**

- 1 PNG + 1 PDF → one image, one doc
- `type=image/png` + HTML bytes → error
- 5 images → error `一次最多添加 4 张图片`
- decoded total > 6MiB → error
- image types do **not** need to be in `allowed_types`

- [ ] **Step 2: Implement partition + wire into `file.upload`**

Order inside the case (spec §5.1 after r2):

1. Decode / sniff / admit each image.
2. Split MIME **before** `allowed_types` / `parseFile`.
3. Parse docs as today (embedded images still `analyzeImage`).
4. Re-validate 4 / 4MiB / 6MiB / serialized frame size of the inbound message (if you still have the raw files array, estimate `JSON.stringify` of what was received).
5. **Then** thread gates (paused / trashed / loop cap).
6. Write sidecars + preview JPEG (96px, quality such that ≤8KB; if `canvas` missing, skip preview — UI falls back to 📎).
7. `useNative = likelyMultimodal(effective.model_name)`.
8. If `!useNative` && vision rail off → `uploadError` (DoD #4).
9. If `!useNative` && vision on → `analyzeImage` each standalone image; build §5.1a suffix; **do not** call `analyzeImage` when `useNative` (spy DoD #3).
10. `chatCreate({ message: userMessage + optional §5.1a block, fileContents: docs, imageAttachments: metas })`.
11. Status strings: images → `正在处理图片…` / `主模型看图中…` or `正在分析图片…`; never `正在解析文档` for a PNG.

§5.1a body when vision rail:

```
${userMessage}
📎 ${names}

<!-- 用户附图分析 -->
[图片: ${name}] ${description}
```

Pass that as `message` so `addMessage` content contains the marker (DoD #16). Do **not** also prepend 📎 again blindly — either put 📎 only in §5.1a or only in adapter; pick **adapter** for native (names only) and **router message** for vision (full block). Simplest: router sets `message` to the full vision block when `!useNative`, and to the raw user caption when `useNative`; adapter always appends `📎 names` if not already present (`if (!userContent.includes("📎"))`).

- [ ] **Step 3: Run file-upload + vision + existing parse tests**

- [ ] **Step 4: Commit** `feat(upload): split images from docs; persist vision descriptions`

---

### Task 8: SW refuse oversized frames

**Files:**
- Modify: `chrome-extension/src/background/index.ts` `case "file.upload"`
- Modify: `chrome-extension/src/sidepanel/types.ts` if needed

Constant: `MAX_WS_FRAME = 10 * 1024 * 1024 - 256 * 1024`.

After computing `jsonBytes`, **before** `wsClient.send`:

```ts
if (jsonBytes > 10 * 1024 * 1024 - 256 * 1024) {
  chrome.runtime.sendMessage({
    type: "file.upload_error",
    thread_id: message.threadId,
    error: "附件总体积过大，请少选几个文件",
  })
  sendResponse({ ok: false, diag: { sent: false, json_bytes: jsonBytes, over_companion_10mb: true } })
  return true
}
```

Do not send. Do not raise companion `maxPayload`.

- [ ] **Step 1: If there is an existing SW test harness, add a case; otherwise add a tiny pure helper**

```ts
// chrome-extension/src/background/ws-frame-budget.ts
export const WS_FRAME_HEADROOM = 256 * 1024
export const MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024
export function shouldRefuseWsFrame(jsonBytes: number): boolean {
  return jsonBytes > MAX_WS_MESSAGE_SIZE - WS_FRAME_HEADROOM
}
```

Test: `10*1024*1024` → true; `8*1024*1024` → false.

- [ ] **Step 2: Wire helper into `index.ts`**

- [ ] **Step 3: Commit** `fix(extension): refuse file.upload frames over WS budget`

---

### Task 9: Composer paste / drop / picker / compress / preflight

**Files:**
- Create: `chrome-extension/src/sidepanel/utils/image-compose.ts`
- Create: `chrome-extension/tests/image-compose.test.ts`
- Modify: `chrome-extension/src/sidepanel/App.tsx`
- Modify: `chrome-extension/src/sidepanel/types.ts` (`FileAttachment` unchanged; optional `compressed?: boolean`)

- [ ] **Step 1: Pure helpers + tests**

```ts
export const IMAGE_MAX_DECODED = 4 * 1024 * 1024
export const IMAGE_MAX_TOTAL_DECODED = 6 * 1024 * 1024
export const IMAGE_MAX_COUNT = 4
export const IMAGE_MAX_EDGE = 1568

export function isAllowlistedImageMime(t: string): boolean { /* png/jpeg/jpg/gif/webp */ }

export function classifyDrop(types: string[], files: Array<{ type: string; size: number; name: string }>): 
  | { ok: true }
  | { ok: false; error: string } {
  if (types.includes("text/uri-list") || types.includes("text/x-moz-url")) {
    return { ok: false, error: "不能从网页链接拉图；请复制图片本身或改用截图" }
  }
  // 0-byte file named like URL → reject
}

export function clipboardImageDisplayName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `截图 ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
}

export function defaultCaption(opts: { images: number; docs: number; userText: string }): string {
  if (opts.userText.trim()) return opts.userText.trim()
  if (opts.images && !opts.docs) return opts.images === 1 ? "请看这张图" : "请看这些图片"
  if (!opts.images && opts.docs) return "请分析我上传的文件"
  if (opts.images && opts.docs) return "请查看附件"
  return ""
}

export function visionRailOpen(cfg: { vision_enabled?: boolean; file_upload_vision?: boolean }): boolean {
  return !!cfg.vision_enabled && cfg.file_upload_vision !== false
}
```

Compress decision (pure): `needsCompress(bytes, width, height)` → true if `bytes > IMAGE_MAX_DECODED || max(width,height) > IMAGE_MAX_EDGE`.

Canvas compress lives in `compressImageBlob(blob: Blob): Promise<{ blob: Blob; compressed: boolean }>` and is **not** unit-tested in node (no canvas). Call it from `InputArea` only when `needsCompress` is true. GIF that still exceeds after skip-canvas → error `动画图请先缩小`.

- [ ] **Step 2: Wire `InputArea` in `App.tsx`**

- `accept` add `.png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp`
- `title` → `添加文件或图片`
- `onPaste` on textarea + composer root: if any `items` is allowlisted image file with `size > 0`, `preventDefault`, read as `File`, sniff-via-type + FileReader, push `selectedFiles`. Do not paste HTML. Keep typed text.
- `onDragOver` preventDefault + highlight; `onDrop` use `classifyDrop` then files. **Never** fetch.
- Ignore paste/drop when `needsThread || disconnected || threadBusy || l2_task || voice.liveOverlay || voice.listening`.
- Mixed send: if `text.trim()` and the incoming gesture added images, call `handleSend(nextFiles)` with the explicit array.
- Preflight: import `likelyMultimodal` from vision-reuse-logic; if `!likelyMultimodal(effectiveModel) && !visionRailOpen(config)` → `setFileError(...)`, do not send.
- Client totals: >4 images / >4MiB each / >6MiB images / refuse. Keep chips.
- `handleSend` must **not** `setSelectedFiles([])` until `file.uploaded` or `file.upload_error` (move clear into those WS handlers) **or** clear only after SW callback `ok: true`. Spec S3: keep chips until stamped result. Preferred: clear on `file.uploaded`; on `file.upload_error` restore if you already cleared — simplest is **don't clear until success**.
- Destination chip: `extractHostname(useNative ? config.base_url : config.vision_base_url)`.
- First native send: if `!chrome.storage.local['cmspark.imageDestAck.'+host]`, show one-line `图片将发送至 {host}`, then set ISO timestamp.

Extract `effectiveModel` the same way settings already read thread override + `config.model_name`.

- [ ] **Step 3: Run** `cd chrome-extension && npm test`

- [ ] **Step 4: Commit** `feat(sidepanel): paste/drop/pick images with preflight and compress`

---

### Task 10: Transcript thumbs + caption-only edit

**Files:**
- Modify: `chrome-extension/src/sidepanel/types.ts` (`Message.attachments?`)
- Modify: `chrome-extension/src/sidepanel/components/ChatView.tsx`
- Modify: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` (`chat.user` adopt `message_id` + attachments)
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx` if ADD_MESSAGE must merge attachments

- [ ] **Step 1: Types**

```ts
export interface MessageAttachment {
  kind: "image"
  name: string
  mime: string
  sha256?: string
  bytes?: number
  preview_jpeg_b64?: string
}
// Message.attachments?: MessageAttachment[]
```

- [ ] **Step 2: `MessageRow`**

Under the markdown bubble (user only), if `msg.attachments?.length`:

```tsx
<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
  {msg.attachments.filter(a => a.kind === "image").map((a, i) => (
    <img
      key={i}
      alt={a.name}
      width={48}
      height={48}
      src={a.preview_jpeg_b64 ? `data:image/jpeg;base64,${a.preview_jpeg_b64}` : undefined}
      style={{ objectFit: "cover", borderRadius: 6, background: tokens.accentSoft }}
    />
  ))}
</div>
```

If no preview, show the 48px empty tile + name. **No** `dangerouslySetInnerHTML`. **No** lightbox.

Edit: `setEditingText` should strip the `📎` line and `<!-- 用户附图分析 -->` block for the textarea (caption only). On regenerate, send the caption; companion keeps attachments (Task 6 `skipUserMessage` + hydrate).

`chat.user` handler: if `message_id` and we have an optimistic user bubble in this thread with a temp id, **replace id** (or ADD_MESSAGE dedup by updating the last user message). This is DoD #13.

- [ ] **Step 3: Commit** `feat(sidepanel): 48px image thumbs and adopt persisted message id`

---

### Task 11: Honesty copy

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/vision-reuse-logic.ts` (`VISION_COPY`)
- Modify: `companion/src/settings-web.ts` (hint at ~668)
- Modify: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` (`file_upload_vision` label ~2152, `file_upload_max_size` hint)
- Modify: `chrome-extension/src/sidepanel/utils/meta-slash.ts` placeholder
- Modify: `chrome-extension/src/sidepanel/components/ChatView.tsx` empty state one line `可直接粘贴截图` (chat/browser only)

Exact strings: spec §8.

`VISION_COPY.sectionHelp` replacement:

```
本段只管工具截图 / analyze_image：先视觉轨转文字再进对话。输入框粘贴/选/拖的图另算——主模型能看图则直送主模型，否则才走本视觉轨。
```

Kill parenthetical `主对话不会直接收图`. Update settings-web English to the same distinction.

`fallbackPassthrough`: visual-rail-only wording from spec.

File-upload vision toggle: “仅当主模型不能看图时，用户附图才走视觉轨…”

`file_upload_max_size`: “此上限不提高图片预算（压缩后单张 ≤4MB，合计 ≤6MB）.”

Placeholder chat/browser: `问任何问题，或粘贴截图…`

- [ ] **Step 1: Grep to prove the lie is gone**

```bash
rg -n "主对话不会直接收图|main loop does not receive image bytes" chrome-extension companion/src/settings-web.ts
```

Expected: no matches (or only in docs/audit historical files).

- [ ] **Step 2: Update `VISION_COPY` tests** if they snapshot `sectionHelp`.

- [ ] **Step 3: Commit** `docs(settings): distinguish user-attach native vs screenshot vision rail`

---

### Task 12: Machine DoD sweep

- [ ] **Step 1: Run suites**

```bash
cd companion && npm test
cd ../chrome-extension && npm test
```

Expected: green. If a pre-existing failure is unrelated, do not "fix" it in this batch — note it.

- [ ] **Step 2: Manual DoD checklist (tick in the PR / session note)**

| # | Check | How |
|---|--------|-----|
| 1 | paste/drop/pick allowlist; HEIC/SVG/URL rejected | helper tests + hand paste |
| 2 | empty composer waits; text+paste sends once | App.tsx mixed-send |
| 3 | native → zero `analyzeImage` | spy in file-upload test |
| 4 | text-only + vision off → no send / upload_error | preflight + router |
| 5 | sniff mismatch / HEIC | image-sniff tests |
| 6 | Anthropic merge keeps image | Task 4 test |
| 7 | model switch strips parts | hydrate test |
| 8 | sidecar 0o600; hard-delete; fork copy | sidecar tests — **fork copy is required**; add `copyAttachmentsToThread(from, to, idMap)` used by fork in `message-router.ts` (~1483). If missed in Task 5, do it here. |
| 9 | SW refuse oversize | Task 8 |
| 10 | no `clipboardRead` | `rg clipboardRead chrome-extension/package.json` empty |
| 11 | settings honesty | Task 11 grep |
| 12 | screenshot / analyze_image tests unchanged | full companion suite |
| 13 | message_id echo | Task 10 |
| 14 | compress chip | `compressed` flag on FileAttachment |
| 15 | kimi-k2 false | Task 1 |
| 16 | vision content marker + regen | Task 7 + adapter skipUserMessage |

- [ ] **Step 3: Commit any fork-copy leftover** `feat(threads): copy image sidecars on fork`

- [ ] **Step 4: Stop.** Do not self-APPROVE. Hand to independent adversary + Claude/Pi dual on the impl diff.

---

## Self-review vs spec

| Spec | Task |
|------|------|
| U1–U4 user locks | 7, 9 |
| P1 thumbs | 10 |
| P2 compress 1568 | 9 |
| P3 preflight + restore chips | 9 |
| P4 edit/regen/fork keep images | 6, 10, 5/12 fork |
| P5 dest hostname + ack key | 9 |
| P6 / §8 copy | 11 |
| S1–S3 WS frame | 8, 9 |
| S4 sniff | 2, 7 |
| S5 sidecar containment | 5 |
| S6 no fetch | 9 `classifyDrop` |
| S7 blob `<img>` | 9, 10 |
| S8 log redact | 7 logger |
| A1–A3 API + hydrate | 3, 6 |
| A4 Anthropic merge | 4 |
| A5 likelyMultimodal SoT | 1 |
| A6 tokens 1600/2800 | 3, 4 |
| A7 message_id | 6, 10 |
| A8 GIF as-is; captions; worker same caps | 9 |
| §5.1a vision text | 7 |
| DoD 1–16 | 12 table |

No TBD. Types (`ImageAttachmentMeta`, `UserContentPart`, `RasterMime`) are defined in Tasks 2–3 and reused later.

---

## Execution

Plan saved to `docs/superpowers/plans/2026-08-17-clipboard-image-paste.md`.

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.

**2. Inline Execution** — this session, executing-plans, checkpoints.

Which approach?
