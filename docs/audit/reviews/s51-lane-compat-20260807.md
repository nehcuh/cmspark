# S51 Lane Review — Compatibility / Platform (Windows focus)

| Field | Value |
|---|---|
| **Lane** | Compatibility / Platform (adversarial) |
| **Date** | 2026-08-07 |
| **Host** | Windows (review host) |
| **Range** | `6d2cdcf..HEAD` (themes: shell tree-kill, voice Web Speech, analyze_image `data:`, settings UX, thread list, Trust pack paths, context budget) |
| **Mode** | Read-only inspection + static cross-end protocol check |
| **Evidence tags** | `[inspected]` unless noted |

---

## VERDICT: **PASS_WITH_NITS**

Matched companion↔extension builds on Windows are shippable for the reviewed themes. No P0 that breaks Stop/timeout tree kill, `data:` analyze_image, or thread batch delete on a **same-generation** pair. Residual gaps are: **Windows process-tree kill untested in CI**, **voice denial UX copy is macOS-biased**, **mixed-version optimistic thread UI**, and a few settings/locale nits.

---

## Scope checked

| Theme | Primary surfaces |
|---|---|
| Shell process-tree kill | `companion/src/capability/shell.ts`, `shell-abort-timeout.test.ts`, `shell-progress-windowsHide.test.ts` |
| windowsHide / spawn | `shellSpawnOptions` / `shellSpawnArgvOptions`, `process-path.ts` essentials |
| Voice Web Speech | `sidepanel/voice/*`, `tabs/voice-permission.tsx`, `useVoiceInput.ts`, Settings 语音输入 |
| analyze_image `data:` | extension `image-extract-utils.ts` + `browser-bridge.ts`; companion `image-data-url.ts` + `server.ts` residual |
| Thread list / protocol | `message-router.ts` batch/cleanup/digest; extension `background/index.ts`, `useWebSocket.ts`, `ThreadList.tsx` |
| Trust pack paths | `packs/validator.ts` `resolveContained`, `pack-engine.ts` zip-slip + `releaseTrustBeforeThreadGone` |
| Context budget | `llm/adapter.ts` `runContextBudgetPass`, `thread.context_compacted` / `_prompt`, ChatView banner |

---

## What is solid (do not reopen without new evidence)

### 1. Shell spawn + kill tree design (Windows-aware) — `[inspected]`

- **`windowsHide: true` always** on shell spawn options (`shell.ts:227`, `:356`) — fixes empty black console flash on approved one-shots. Unit-locked in `shell-progress-windowsHide.test.ts:18-21`.
- **`detached: false` on win32**, `true` on POSIX (`shell.ts:228-229`, `:357`) — correct split: POSIX needs process-group leader for `kill(-pid)`; Windows uses `taskkill /T` and comments correctly warn detached can orphan oddly.
- **`killProcessTree`** (`shell.ts:96-123`):
  - win32: `taskkill /pid <pid> /T /F` + `windowsHide: true`
  - POSIX: `process.kill(-pid, "SIGKILL")` with bare `child.kill` fallback
- **Argv vs shell:true on win32** (`shouldUseArgvSpawn`, `shell.ts:303-315`): only `.exe`/`.com` take `shell:false`; bare names (`npm`), `.bat`/`.cmd` stay `shell:true` — matches Node EINVAL reality. Tests pin B1/N1b (`shell-progress-windowsHide.test.ts:72-87`).
- **Windows path backslashes in quoted args** preserved (`tryParseSimpleArgv`, only escape `\"`/`\'`/`\\`) — test at `:43-48`.
- **PATH harden for shell children** includes `System32`, Wbem, PowerShell `v1.0`, npm, nodejs (`process-path.ts:76-85`) so `taskkill`/PowerShell remain findable after GUI-corrupt PATH.

### 2. analyze_image `data:` false Security Block — fixed with skew residual — `[inspected]`

- Extension **never** returns `fetch_required` for `data:` — `promoteFetchSrc` → canvas / gated error (`browser-bridge.ts:552-575`, `image-extract-utils.ts:182-197`).
- Companion residual path if old extension still emits `fetch_required` + `data:`: local `decodeDataUrlImage` (MIME allowlist + 6 MiB), **no** L2, **no** phase-2 fetch, **no** `schemeOk` expansion to `data:` (`server.ts:2463-2515`).
- Error/log hygiene: short placeholder URL `data:${mime};base64,…` — no multi-KB payload in tool errors.
- Cross-pin constants: `ALLOWED_IMAGE_MIMES_LIST` + `IMAGE_DATA_URL_MAX_DECODED_BYTES` duplicated extension/companion with explicit lock-step comments.

### 3. Thread History IA protocol (same-gen) — `[inspected]`

| Message | Companion | Extension bridge | Side panel |
|---|---|---|---|
| `thread.batch_delete` | max 50, mode hard\|trash (default trash), busy reject, trust release, `ok`/`failed` | maps mode hard vs trash (`background/index.ts:762-771`) | multi-select + cleanup apply |
| `thread.batch_deleted` | return payload | — | `REMOVE_THREADS` + log; tolerates `ok` or `deleted_ids` |
| `thread.trashed` / `thread.deleted` / `thread.restored` | broadcast per id | — | list hygiene |
| `thread.cleanup_empty` / `.completed` | trust release empty + hard delete | yes | refresh list |
| `thread.list` + `list_scope` | active\|all\|trash echo | include_trashed / only_trashed | trash-scoped list does not auto-create blank chat (`useWebSocket.ts:892-917`) |
| `thread.digest_updated` | UPSERT or list refresh | extract path | ok |
| `thread.context_compacted` / `_prompt` | adapter budget pass | — | dual-truth banner + rolling_summary from event or thread meta |

Single-delete default **hard** vs batch default **trash** is intentional and dual-end aligned (`background/index.ts:752-758` vs batch default trash).

### 4. Trust release on thread gone — `[inspected]`

- `releaseTrustBeforeThreadGone` on batch_delete (`message-router.ts:1253`) and cleanup_empty (`:1346-1349`) prevents sticky cruise after recycle/delete.
- Install path strips spoofed `origin=user` + trust (`sanitizeManifestForInstall`) — only `saveUserPack` may author trust block.
- Pack path containment uses `realpath` + `path.relative` (`validator.ts:39-54`); zip extract uses `path.resolve` + `startsWith(tmpReal + path.sep)` (`pack-engine.ts:1094-1107`).

### 5. Voice (Chrome MV3 Side Panel) — core flow correct — `[inspected]`

- Feature detect `SpeechRecognition` / `webkitSpeechRecognition` (`detect.ts`).
- Privacy ack v1 gate + Settings toggle (`SettingsSlideout.tsx:914-954`, `agentStore` + `chrome.storage.local`).
- Permission bootstrap via full tab `tabs/voice-permission.html` when Permissions API is not `granted` (`useVoiceInput.ts:146-162`) — correct for Side Panel prompt starvation.
- Offline: hard-stop before start (`navigator.onLine === false` → `offline` error) + `resolveMicChrome` can disable chrome.
- Max listen 45s; never auto-send; chat Stop aborts engine.
- Voice is **extension-local** (no new companion message types) — zero WS protocol surface for mic audio.

---

## Findings

Severity: **H** = real Windows/user breakage risk · **M** = noticeable gap / skew · **L** = nit / doc / test debt  
Action: **fix** / **follow-up** / **accept**

### F1 — [M][follow-up] Windows process-tree kill is code-correct but **untested** on this host class

**Where:** `companion/tests/shell-abort-timeout.test.ts:109-113` skips the only grandchild-orphan assertion on `win32`; remaining cases use `command: "sleep 30"` (`:57`, `:80`, `:97`).

**Why it matters on Windows:**

1. `cmd.exe` has no `sleep` builtin. Under `spawn(..., { shell: true })` those cases often exit immediately with “not recognized”, so abort/timeout registry tests do not exercise a long-lived tree.
2. The POSIX test proves grandchildren die; **no equivalent** `timeout /t` / PowerShell `Start-Sleep` + marker-file assertion exists for `taskkill /T /F`.
3. Product path (`killProcessTree` → fire-and-forget `taskkill`) is therefore regression-prone on the platform this review host runs.

**User impact:** Stop / timeout may leave **cmd grandchildren** (or breakaway jobs) if `taskkill` fails silently — rare but high pain when user believes “停止” killed a build.

**Minimal fix:** Add `win32` branch tests:

```text
command: "ping -n 30 127.0.0.1 >nul"   # or powershell -NoProfile -Command "Start-Sleep -Seconds 30"
```

and a tree case: shell metachar chain that writes a marker after delay; assert marker absent after timeout + short settle.

**Not REQUEST_CHANGES:** implementation matches documented Windows approach; gap is verification, not an observed wrong API choice.

---

### F2 — [L][accept/follow-up] `killProcessTree` does not wait on `taskkill`

**Where:** `companion/src/capability/shell.ts:100-104` — `spawn("taskkill", …)` without `close` wait or exit-code check; fallback `child.kill()` only if spawn throws.

**Impact:** Race: Promise may settle on parent `close` while `/T` still walks the tree (usually milliseconds). If `taskkill` is missing from PATH of the **companion** process (not child env), kill silently degrades to nothing useful after catch-less spawn success of a failing binary… actually spawn of missing binary emits `error` event, not throw — **unhandled**: no `error` listener on the taskkill child → tree may survive.

**Note:** Companion PATH is not the hardened child PATH; normal Windows installs have `System32` on PATH. Harden does not apply to the taskkill spawn itself.

**Fix (optional):** `spawnSync("taskkill", …, { windowsHide: true, timeout: 5000 })` or listen for error + fallback `child.kill()`.

---

### F3 — [M][fix] Voice permission denial copy is **macOS-only**; Windows users misdirected

**Where:** `chrome-extension/src/tabs/voice-permission.tsx:44-46`

```text
请在 Chrome 站点设置与 macOS「系统设置 → 隐私与安全性 → 麦克风」中允许…
```

**Impact (real Windows):** After deny, users never see **Settings → Privacy → Microphone → Google Chrome** / per-app mic. Side Panel error-map is slightly better (“系统隐私”) but still non-specific (`error-map.ts:20-26`).

**Fix:** Platform-branch or OS-agnostic copy:

- Windows: 设置 → 隐私和安全性 → 麦克风 → 允许 Chrome / 本扩展  
- macOS: keep current  
- Or single line: “Chrome 站点设置 + 操作系统麦克风隐私”

---

### F4 — [L][accept] Voice locale hard-locked `zh-CN`; no Settings control

**Where:** `VOICE_DEFAULT_LANG = "zh-CN"` (`detect.ts:83`); adapter/permission/spike all use it; Settings only toggles enable + privacy reset (`SettingsSlideout.tsx:914-954`).

**Impact:** English (or other) Windows dictation quality degrades unless user relies on system IME dictation. Product-default for CMspark CN is plausible — **not a blocker**. Offline Chrome speech still requires network/language pack (`network` / `offline` errors correctly mapped).

---

### F5 — [M][follow-up] Thread batch delete is **optimistic** without skew recovery

**Where:** `ThreadList.tsx:291-304`, `:343-344` — `REMOVE_THREADS` **before** companion ack; only `thread.batch_deleted` / per-id broadcasts heal state.

**Protocol skew:**

| Pair | Behavior |
|---|---|
| New ext + new companion | OK — broadcasts + `batch_deleted` |
| New ext + old companion | `Unknown message type: thread.batch_delete` (`message-router.ts:3223-3224`) → generic `error` case; **no list rehydrate** keyed to batch op → rows vanish until next full `thread.list` |
| Old ext + new companion | batch UI absent; single delete still works |

**No `protocol_version` handshake** on WS connect (pre-existing debt) — new message types rely on “reload both sides” ops discipline.

**User impact:** Partial upgrades (common on Windows when only Companion MSI/daemon restarted or only extension reloaded) → “deleted” threads reappear after refresh, or opposite ghost absence.

**Fix:** On `error` containing `thread.batch_delete` / unknown type, `thread.list` refresh; or await response correlation before optimistic remove. Demote packaging-only version skew if release always ships both artifacts together.

---

### F6 — [L][accept] Settings `Cmd+Enter` is a no-op on Windows keyboards

**Where:** `App.tsx:603-607` (comment admits Win/Linux no-op); option still listed (`SettingsSlideout.tsx:908-910`).

**Impact:** User picks Cmd+Enter → Enter no longer sends; Ctrl+Enter also blocked. Comment is honest; still a footgun on this host OS.

**Nit fix:** Hide `Cmd+Enter` when `navigator.platform` / userAgent is Win32, or map Cmd+Enter → Ctrl+Enter on Windows.

---

### F7 — [L][follow-up] Pack zip-slip containment is case-sensitive `startsWith`; Downloads sandbox is case-folded

**Where:**

- Zip: `pack-engine.ts:1096`, `:1106` — `real.startsWith(tmpReal + path.sep)` **no** `.toLowerCase()`
- Contrast: `path-sandbox.ts:55-61` — NTFS-aware case-insensitive `isWithinRoot`

**Impact:** Theoretical: casing mismatch between `mkdir` path and `realpath` could false-reject extract (fail-closed) more than false-allow. Zip-slip still blocked by `path.resolve` collapse of `..`. **Not a practical exploit** on normal Windows installs; consistency nit vs host download sandbox.

Workspace containment (`workspace.ts:68-70`) uses `path.relative` (drive-crossing absolute rel correctly rejected) without case fold — same class, fail-closed on weird casing.

---

### F8 — [L][accept] Context budget events degrade safely on old extension

**Where:** `adapter.ts:490-623` emits `thread.context_compacted` / `thread.context_compact_prompt`; extension handles both (`useWebSocket.ts:713-748`). Mid-loop M1 preserves prior M2 `rolling_summary` (`adapter.ts:556-578`).

**Skew:** Old extension ignores unknown types → compaction still applies server-side; user only loses banner/modal. **Correct dual-truth** (UI history full). Accept.

---

### F9 — [L][accept] Manifest has no `audioCapture` permission

**Where:** `chrome-extension/package.json` permissions list (debugger, tabs, sidePanel, …) — no `audioCapture`.

**Impact:** Web Speech in extension pages relies on Chrome’s extension-origin mic prompt via bootstrap tab — intentional SoT pattern, not packaging bug. Do not add broad `audioCapture` without product review (permission chrome warning surface).

---

## Cross-version protocol matrix (new types)

| Type | Old companion | Old extension |
|---|---|---|
| `thread.batch_delete` / `batch_deleted` | error string | no multi-select; ignore event |
| `thread.cleanup_suggestions` / `cleanup_empty.completed` | error / ignore | ignore / no UI |
| `thread.digest_updated` / `extract_digest.completed` | ignore | ignore |
| `thread.context_compacted` / `_prompt` | n/a if old companion | ignore (server still compact if new) |
| Voice | n/a | n/a (local only) |
| analyze_image residual `data:` | old companion may still false-block | new companion residual fixes old ext skew |

**Ops requirement:** Ship companion + extension together for History IA + shell abort. No automated version gate.

---

## Windows vs theoretical — summary table

| Claim | Real Windows impact? | Status |
|---|---|---|
| `windowsHide` kills black flash | Yes — daily shell_exec | Fixed / covered by unit |
| `taskkill /T` kills tree | Yes when Stop/timeout | Implemented; **tests skip win32** (F1) |
| `detached:false` on win32 | Yes (orphan risk if flipped) | Correct |
| `.bat`/`.cmd` shell:true | Yes — Node EINVAL | Correct + tested |
| `sleep` in tests | Dev/CI on Windows | Misleading green/fail (F1) |
| Voice mic grant | Yes — Side Panel + bootstrap tab | Flow OK; **deny copy wrong OS** (F3) |
| Voice offline | Yes — Chrome cloud ASR | Handled |
| analyze_image captcha `data:` | Yes | Fixed + residual |
| Batch trash/hard | Yes | Same-gen OK; skew optimistic (F5) |
| Trust sticky after delete | Yes (cruise) | releaseTrust on batch/cleanup |
| Cmd+Enter setting | Yes footgun | Documented no-op (F6) |
| Pack zip case fold | Mostly theoretical | Nit (F7) |

---

## Demotions (not raised to REQUEST_CHANGES)

- Unreleased DMG/tray packaging, Swift tray hashes — out of Windows host path.
- PTY interactive shell epic — not in this ship; one-shot + progress tails only.
- Full protocol version negotiation — longstanding debt; not introduced solely by S51 themes.
- Duplicated image MIME allowlist (extension vs companion) — intentional skew isolation; residual DRY only.

---

## Recommended follow-ups (priority)

1. **F1** — Windows `shell_exec` abort/timeout tree-kill integration tests (replace `sleep` with `ping`/`Start-Sleep`).
2. **F3** — Fix voice-permission denial copy for Windows (and Linux).
3. **F5** — On batch_delete protocol error, force `thread.list` rehydrate (cheap safety for mixed reload).
4. **F2** (optional) — `spawnSync` taskkill or error listener + fallback.
5. **F6** (optional) — Platform-filter send-shortcut options.

---

## Verdict rationale

- **Not PASS:** F1 (Windows kill untested) + F3 (user-facing wrong OS copy) + F5 (optimistic batch under skew) are real, not theoretical-only.
- **Not REQUEST_CHANGES:** No inspected path shows wrong kill API, broken `data:` gate on current dual stack, or Trust sticky by design omission on batch delete. Issues are verification gaps, UX copy, and version-skew hygiene — fix-forward without blocking merge of correct same-gen artifacts.

**VERDICT: PASS_WITH_NITS**
)
