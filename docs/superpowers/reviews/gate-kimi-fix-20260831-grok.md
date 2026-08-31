I'll treat this as a read-only adversarial review of HEAD plus the attached diff, starting with routing and the review-gate skill, then verifying the code paths against the claimed restore/grant semantics.Routing selected the adversarial reviewer skill. I'll load it and follow its workflow against HEAD plus the attached diff.I'll confirm HEAD, then dispatch independent architecture/correctness/security/docs lanes and inspect the actual source in parallel.HEAD is `6e5083fb` with the five-file diff already in the working tree. Next I’ll dispatch independent review lanes and read the restore/grant paths myself.I'll inspect the stash/restore state machine, config persistence, and the new tests against HEAD plus the working-tree diff.I'll review the working-tree change against HEAD for stash/restore, config hygiene, and ADR-022/023 alignment—starting with the five scoped files and related voice/outbound paths.I'll review the HEAD + working-tree voice/config and ADR-022 changes as a read-only security pass, starting with the listed files and the grant/exfil implementations they document.I'll review the listed HEAD + working-tree files against ADR-022/023 and the UX claims, starting with handlers, tests, and the two ADRs.Next I’ll read `setVoiceFields`/`saveConfig` and the catalog/state helpers so stash persist, merge, and probe/listReady paths are grounded.Next I’ll read the voice handlers, `setVoiceFields` merge/sanitize path, tests, and both ADRs so the state machine can be checked against shipped semantics.I've got the ADR text; next I'll read the voice write paths and outbound grant/exfil implementations line-by-line to check the documented gates.Config merge and `getConfig` defaults may treat unset `localModelId` as `"medium"`—I'll verify that against stash-only-explicit and the ADR text.Next I’ll check whether state payloads expose the stash, how config defaults interact with “explicit” `localModelId`, and whether ADR-022’s Grant row matches the actual grant code.Checking a few remaining fidelity details: whether `set_engine` restores a ready stash, and how the settings UI surfaces `localModelId`.# PRODUCT-UX / docs review

Scope: HEAD `6e5083fb` + working-tree on the five listed files. No extension-side work invented. Existing UX floors re-checked.

**VERDICT: BLOCK** (1 MAJOR; 2 NITs)

---

## 1. Silent restore / “is the user told?” — **not a finding**

Original MAJOR was **silent preference loss**. This patch restores the explicit `localModelId` and then **tells the truth about what is active**.

`voice.model.state` still carries the live active id (`localModelId`). Settings, summoner, and `lastKnownVoiceModelId` all bind that field. After auto-correct or restore, the next `get_state` / download broadcast is the model that will actually run.

```35:55:companion/src/voice/whisper-state.ts
export interface VoiceModelStatePayload {
  type: "voice.model.state"
  sttEngine: "browser" | "local"
  localModelId: WhisperModelId
  // ...
  autoFallbackToBrowser: boolean
  modelDownloadEndpoint: string
}
```

```1363:1367:chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
              const recommendedId = RECOMMENDED_WHISPER_MODEL_ID
              const activeId = voiceModel?.localModelId || recommendedId
```

ADR-023 (二) does **not** require a restore banner. Visible chrome is reserved for **engine** fallback (L13 `autoFallbackToBrowser`), not intra-local model swap. Logs (`voice.model.get_state.auto_corrected_active` / `auto_correct_restored`) are operator traces, not a product surface — that matches the “no extension-side changes” boundary.

Stash is **not** on the wire. The user cannot see “will return to large-v3-turbo.” They **can** see which model is active. That is enough vs ADR-023 and vs “unable to know which model is active.” Do not treat missing toast/stash UI as a gap.

---

## 2. ADR-023 修订（二） vs code

Header claim:

```7:7:docs/adr/023-voice-local-stt-path-b.md
**修订（2026-08-31，二）**：auto-correct 由**单向**改为**可恢复**——`get_state` / `set_engine local` 把显式配置的 `localModelId` 修正为已就绪模型时，原选择暂存于 `voice.localModelAutoCorrectedFrom`；该模型一旦 ready（下载完成或 `get_state` 自愈探测）即恢复并清除暂存。用户显式 `set_active` 或删除被暂存模型时暂存清除。默认/未显式设置的 `localModelId` 不暂存（无偏好可恢复）。`sttEngine` 仍不被任何自动路径触碰。
```

| Claim | Code | Result |
|---|---|---|
| `get_state` stashes explicit `localModelId` | `autoCorrectActiveLocalModel`: `explicit && !stashed` → `localModelAutoCorrectedFrom` | Match (`whisper-handlers.ts:219-224`) |
| `set_engine local` stashes explicit id | `overrideFrom` only if `cfg.localModelId` is a real catalog id; does not overwrite existing stash | Match (`:583-619`) |
| Restore when ready (download **or** `get_state`) | `maybeAutoActivateModel` probe-gates stash (`:171-177`); `autoCorrectActiveLocalModel` self-heals (`:208-212`) | Match. Download success without probe `ready` does **not** restore (correct: “一旦 ready”) |
| `set_active` clears stash | `setVoiceFields({ localModelId, localModelAutoCorrectedFrom: undefined })` (`:542`) | Match (any explicit `set_active`, slightly broader than “of the stashed model” — fine) |
| Delete of **stashed** model clears stash | `clearStash = cfg?.localModelAutoCorrectedFrom === modelId` (`:488-493`) | Match |
| Default / unset not stashed | Only **falsy** `localModelId` is skipped | **NIT** — see below |
| `sttEngine` never touched by **auto** paths | A1/A2/`set_prefs` never write engine | Match |

**Delete-active vs “auto path”:** delete of the **active** local model still forces `sttEngine: "browser"` (`:483-499`). That is an explicit `source:"settings"` mutator, not get_state/download auto-correct. ADR’s “自动路径” wording is accurate. Keep the existing UX floor.

---

## 3. ADR-022 Grant row vs HEAD — **not an overclaim**

Grant is a real code path at HEAD, not a skeleton:

- `companion/src/outbound-mcp/outbound-grants.ts` — `cmg_` 32B token, sha256 store, revoke/expiry, `allow_page_export`
- HTTP per-key: `denyOutboundExfilIfNeeded(..., { grant_id })` → `grantAllowsPageExportById` (`facade.ts:77-79`, `companion-http.ts` authenticated Bearer only)
- stdio per-caller: `bridge.ts:110` calls deny **without** `grant_id` → `grantAllowsPageExport(caller)`
- HITL still `hasOutboundDisclosure(caller_id)` on both tracks (`facade.ts:99`)

L4+ 2026-08-31 note (`docs/adr/022-outbound-mcp-server.md:81`) matches that algebra verbatim.

Impl-map Grant row (`:222`) is `✅ 代码路径（2026-08-31）`, **not** “P1 product shipped.” Header (`:3`) still **未产品 ship / 非 default-on**. §7 P1 still includes interact profile + install docs + dual-review (`:135`). Line ~190 maintenance gate is satisfied by the L4+ note + changelog (`:190-193`, `:237`).

Operators treating ADR as SoT will **not** read this as “P1 complete, ship it.” No docs MAJOR.

---

## 4. MAJOR — lying test name

```652:675:companion/tests/voice-whisper-handlers.test.ts
test("download completion restores stashed preference once that model is ready", async () => {
  // ...
  // Probe still reports the stashed model absent at completion → no restore;
  // correction and stash are kept for a later ready event.
  assert.equal(getConfig().voice?.localModelId, "small")
  assert.equal(getConfig().voice?.localModelAutoCorrectedFrom, "large-v3-turbo")
})
```

Name says restore-when-ready. Body **asserts no restore** (probe still `absent` after a no-op `downloadImpl`). The real restore pin is the next test (`:677` “download completion of the stashed model itself restores it”).

This is a product/docs lie for maintainers: the next person will “fix” the name by asserting restore, or will think restore is broken. Rename to something like `download completion does not restore stash while stashed model still probes absent`.

---

## 5. Existing UX floors — hold `[inspected]`

| Floor | Evidence |
|---|---|
| `set_engine local` with no ready model errors, **zero write** | `whisper-handlers.ts:573-579`; test `:174-190` still asserts `NO_READY_MODEL` and `sttEngine` unchanged |
| Delete of **active** local model forces browser | `:483-499`; test `:442-467` |
| A1 download auto-activate **never** writes `sttEngine` | `maybeAutoActivateModel` only `localModelId` / stash (`:168-186`); tests `:486-541` |

---

## NITs

**NIT-1** — ADR-023 “默认/未显式设置不暂存” is stricter than code. Handlers stash any truthy `cfg.localModelId` (`:219-223`, `:587-590`). `getConfig()` always hydrates `localModelId: "medium"` (`config.ts:526-532`, `:864-888`). Production cannot express “unset”; default **medium is stashed**. User-visible effect is restoring the recommended model — harmless, but the ADR sentence is false as written. No test pins the unset path.

**NIT-2** — ADR-023 §6 config table (`:149-159`) still omits `voice.localModelAutoCorrectedFrom`; §13 修订记录 (`:295-300`) still only lists 2026-08-07. The (二) paragraph at the top is the live SoT; the body/changelog are stale.

---

## Out of scope (deliberate)

- Stash in `config.json` (not process memory)
- `undefined` drop via `JSON.stringify`
- No new WS types / no extension UI
- Delete-active engine flip (explicit delete, not auto)

---

**Fix to unblock:** rename the test at `companion/tests/voice-whisper-handlers.test.ts:652` so the name matches the no-restore assertions. NITs can ride a follow-up.# SECURITY review — voice stash restore + ADR-022 L4+ note

Scope: current tree at HEAD `6e5083fb` + the listed working-tree files. Read-only. No outbound-mcp TypeScript in this diff.

**VERDICT: PASS_WITH_NITS**

No BLOCK / no MAJOR. ADR-022 L4+ matches the shipped gate. Voice restore does not switch `sttEngine` and does not weaken `privacy_ack_v2`.

---

## 1. Config tamper / WS injection of `localModelAutoCorrectedFrom`

**No WS write of an unsanitized stash.** The field is never taken from a client message.

| Path | Writes stash? |
|------|----------------|
| `voice.model.*` | Only from `cfg.localModelId` / existing stash. `rest.*` is not read. `validate.ts` has no such field. |
| `config.set` / `settings.set` | Allow-list; **no `voice`**. `/Users/huchen/Projects/cmspark/companion/src/message-router/handlers/config.ts` |
| settings-web `/api/config` POST | llm + vision only |
| Pack | `voice*` prefix still strips a nested `voice` object (`packs/types.ts` `VOICE_FORBIDDEN_KEY_RE`) |

Write sites in `/Users/huchen/Projects/cmspark/companion/src/voice/whisper-handlers.ts`:

- Stash: `223` (`cfg.localModelId`), `617-618` (`overrideFrom` **after** `isWhisperModelId` at `588`)
- Restore: `173-175`, `208-210` (`cfg.localModelAutoCorrectedFrom`)
- Clear: `493`, `542`, restore `undefined`

Load-time allowlist: `/Users/huchen/Projects/cmspark/companion/src/config.ts:941-948` — anything other than `small` \| `medium` \| `large-v3-turbo` is deleted.

Model dirs are `path.join(root, id)` with `isWhisperModelId` exact membership (`session-caps.ts:30-36`, `whisper-download.ts:285-287`, `115-116`). A junk stash cannot become a path/command.

`setVoiceFields` (`config.ts:1118-1142`) does **not** re-validate on write; handlers + load-time + production `probeWhisperModelDir` close injection. Cache after `setVoiceFields` is not re-sanitized — NIT #1.

---

## 2. `setVoiceFields` undefined-clear / delete vs restore race

**Undefined-clear works** as the existing idiom: spread puts `localModelAutoCorrectedFrom: undefined`, `JSON.parse(JSON.stringify(updated))` drops the key on disk (`config.ts:1132`, `1139`). In-memory value is falsy; restore is `if (stashed && probe…)`. Not re-litigated.

**After `deleteImpl`, files are gone before stash clear.** `whisper-handlers.ts:480-494`: `await del(...)` then `getConfig` + `setVoiceFields`. `deleteWhisperModel` (`whisper-download.ts:372-378`) is `rm(destDir, { recursive, force })`. Post-`await` work is **synchronous** (Node does not yield until the next `await`). Restore cannot sneak in **between** successful `rm` and stash clear.

**During** `await del()`, a concurrent `get_state` can still run (`get_state` does not look at `activeDelete`). If probe still says ready, restore can promote the dying model; the delete handler then sees `wasActive` and **force-browser** (`483-494`). Fail-closed; settings `get_state` is on open, not a tight poll. NIT #2.

Failed `deleteImpl` skips stash clear (`511-516`) — correct (preference still exists). Restore later still requires `probe === "ready"` (hash+size), so a deleted tree is not revived from empty dirs.

---

## 3. ADR-022 L4+ vs code (verbatim)

The new L4+ paragraph is **accurate** for the shipped dual-track gate. Docs-only; it does not weaken the perceived gate (stdio is documented as the **weaker** caller-level flag check, which is what `bridge`/`facade` actually do).

| ADR claim | Implementation |
|-----------|----------------|
| HTTP: authenticated `grant_id`, **that key’s** `allow_page_export` | `companion-http.ts:428,447-451,737-745` (`grant_id: auth.mode === "grant" ? auth.grant_id : undefined`); `facade.ts:77-79` → `grantAllowsPageExportById`; `outbound-grants.ts:354-364` |
| stdio: no grant credential → **any live flagged grant for caller** | `facade.ts:79,151-157`; `bridge.ts:106-110`; `stdio-server.ts:197-202` `invokeOutboundTool` with no `grant_id`; `outbound-grants.ts:328-346` |
| HITL `hasOutboundDisclosure` **per-caller on both tracks** | `facade.ts:99` `hasOutboundDisclosure(cid)` regardless of `grant_id`; `disclosure-session.ts:48-56` Map keyed by caller |
| `disclosure_accepted` + HTTP/stdio acknowledge **do not** satisfy exfil | `facade.ts:23-28,67,151`; HTTP `companion-http.ts:695-703` `ACK_NOT_OPERATOR` (does **not** call `acceptOutboundDisclosure`); stdio `stdio-server.ts:146-160` same |
| `grant_id` never from body | Body type `companion-http.ts:419-424` has no `grant_id`; invoke uses auth only `737-745` |
| `GRANT_CALLER_MISMATCH` binds `caller_id` | `outbound-grants.ts:260-267`; HTTP invoke `725-735`; disclosure `681-692` |

Default `outbound_mcp.require_grant: true` (`config.ts:422`) so product HTTP is grant-mode / per-key. `require_grant=false` ws_secret HTTP falls back to caller-level (`745` `grant_id` undefined) — pre-existing bake-off, not this note’s claim about authenticated grants.

---

## 4. Does this diff change grant/exfil behavior?

**No.** Touched paths are `config.ts` voice field, `whisper-handlers.ts`, handler tests, ADR-022/023 markdown. `companion/src/outbound-mcp/**` is unchanged. No accidental outbound behavior change.

---

## 5. Voice restore vs `sttEngine` / `privacy_ack_v2`

Restore / auto-activate **never write `sttEngine`**: `whisper-handlers.ts:163-166,175,185,198,210,220`.

`set_engine local` still requires `privacy_ack_v2 === true` **before** any write (`565-571`); no-ready-model still zero write (`573-579`). Tests at `voice-whisper-handlers.test.ts:174-189` still pin that.

`set_engine` stash (`746-760`) only runs after ack. `get_state` restore only when `sttEngine === "local"` (`207`) — engine already opted in. Browser-engine `maybeAutoActivateModel` restore only moves `localModelId`, not the engine.

---

## Findings

### NIT-1 — restore / get_state stash write without `isWhisperModelId` belt
`whisper-handlers.ts:173-175,208-210,219-223` vs `588` (set_engine has the belt). Production: load-time allowlist + `probeWhisperModelDir` reject unknown ids. `setVoiceFields` also does not re-run `config.ts:941-948`. Not a WS injection path.

### NIT-2 — `get_state` ignored during `activeDelete`
`whisper-handlers.ts:353-356` vs `478-481`. Concurrent restore during `rm` can flip a stashed delete into “deleted-active → browser”. Fail-closed; no leftover `engine=local` on a removed tree after the delete handler finishes.

### NIT-3 — load-tamper tests not in `voice-config.test.ts`
Sanitizer exists (`config.ts:941-948`); `voice-config.test.ts` still has no `localModelAutoCorrectedFrom` cases. Handler tests pin happy-path stash/restore, not disk junk.

---

Not raised (per instructions): config.json-backed stash, `JSON.stringify` undefined drop, ADR-022 docs-only **given accuracy above**.

**PASS_WITH_NITS**## Findings

### MAJOR — default `localModelId` is always “explicit”; stash/restore fires on the common path

**Contract (same diff):** ADR-023 修订（二） and the handler comments say *unset/default `"medium"` is not stashed* (`explicit && !stashed`).  
**Code:** that guard is dead after `getConfig()`.

- `DEFAULT_CONFIG.voice.localModelId` is always `"medium"` (`companion/src/config.ts:527-533`).
- Load path `deepMerge(defaultConfig, parsed)` fills omitted keys (`companion/src/config.ts:649`).
- Missing/illegal `voice` block is coerced to `localModelId: "medium"` (`companion/src/config.ts:864-888`).
- Stash write uses `const explicit = cfg.localModelId` then `explicit && !stashed` (`companion/src/voice/whisper-handlers.ts:219-223`). After `getConfig()`, `explicit` is always a valid id.
- `set_engine local` uses the same mistake: `if (cfg?.localModelId && isWhisperModelId(cfg.localModelId)) overrideFrom = …` (`companion/src/voice/whisper-handlers.ts:588-618`).

**Failure mode (primary install, not an edge):** user never picks a model (stays on product default medium). They download `small` (faster) and `set_engine local`. Medium is not ready → handlers stash `"medium"` and activate `small`. Later they download the recommended `medium`. `maybeAutoActivateModel` restores first whenever the stash probes `ready` (`companion/src/voice/whisper-handlers.ts:173-177`) **even if current `localModelId` is already a ready model** — silent switch `small → medium` without `set_active`.

This is not “re-litigating” the boundary; the boundary is stated in the diff and not implemented. Existing A2 test (`get_state auto-corrects stale localModelId…`, `companion/tests/voice-whisper-handlers.test.ts:546-560`) uses default `medium` and never asserts stash absence, so this yank is unpinned.

To actually honor the claim: stash only when disk/raw `localModelId` is present and ≠ product default, or compare against `DEFAULT_CONFIG` before merge — not `cfg.localModelId` after deepMerge.

---

### NIT — stash clear is not proven on disk; tamper field has no test

- Clear uses `setVoiceFields({ localModelAutoCorrectedFrom: undefined })` (`companion/src/voice/whisper-handlers.ts:175, 210, 493, 542`). `JSON.parse(JSON.stringify(updated))` drops the key on disk (`companion/src/config.ts:1132-1138`); **in-memory** `cachedConfig` keeps the key with value `undefined`. Consumers use truthiness, so behavior is OK.
- New tests assert `getConfig().voice?.localModelAutoCorrectedFrom === undefined` **without** `clearConfigCache()` + disk re-read (`companion/tests/voice-whisper-handlers.test.ts:649, 720, 741`). They would still pass if disk retained the key.
- Load-time tamper delete exists (`companion/src/config.ts:941-948`) but is not covered in `companion/tests/voice-config.test.ts` (that## VER file is notDICT: ** in thisPASS_WITH_ diff). InvalidN stashITS**

Production stash is fail/restore is consistent- andclosed on * failnext cache- miss*closed. No path restores a model that production only `.

probe---`

 would### NIT — ADR-023 body vs header; not call `ready`. No JS-level double-restore resurrection (both one restore test is misnamed

- Header 修订（二） matches restore writers/clear rules are sync; ` (`docssaveConfig` is/adr/023 documented-voice-local single-stt--threaded).path Residual-b.md:7`). issues § are test quality13 and 修订记录 still un only has pinned edges2026-08,-07 (`docs not a broken/adr/023 state-voice-local machine.

---

-##st Scenariot-path-b.md trace:295-300 (A–L`).
- Test)

### `" A. getdownload completion restores st_state,ashed preference once that explicit not model is ready"` ready, another ready (`companion/tests/ →voice stash-whisper + overwrite

[-handlers.test.tsinspected] **:652-Yes.** `auto674`) keepsCorrectActiveLocalModel probe` ( `absent` andengine **asserts no=local restore**.), Real stash restore is the next empty, ` test (`:677-701`).probe(active Not vacuous,)` not ready, but `ready.length > it 0`, then does not pin the:

```214 title.

:224---

##: Hunt itemscompanion

/src**/voice/whisper-handlers.ts
1. Restore    const active/stash stateId = (cfg machine (.localModelIdother ?? RECOMMENDED_WHISPER than default-stash above_MODEL) as Whisper)** —ModelId
 no finding  
    if (probe- Restore onlyModel(deps, activeId).status if `probeModel === "ready") return
    const(..., ready st =ashed ready).Liststatus === "ready"`(deps)
    (`whisper-handlers.ts: if (ready.length === 0)174 return
    const,  next = AUTO_209`). IncompleteACTIVE_PRIORITY.find/absent((id) => does not ready restore.includes.(  
id)) ?? ready[- Restore0]!
    const explicit = cfg +.localModelId `
    setVoicesetVoiceFields(...,Fields({
      local localModelId:ModelAutoCorrectedFrom: undefined)` next,
      ...( thenexplicit && !st returnashed ? { localModelAutoCorrected — no doubleFrom: explicit }-restore : {}),
    in })
```

Pinned one call. Second by ` test atget_state` ` seescompanion/tests/ emptyvoice-whisper- stash and a readyhandlers.test.ts: active.  
-595`.

### `set_active B. existing` always clears stash stash, another correction (` → stash: not542`). Subsequent overwritten

[ins `pected] **Yesget_state`.** `explicit && with !stashed` is false when `stashed` is a ready active does not re-write stash truthy,.  
- Delete so the stash of the stashed key id clears is omitted and it ` (`:489setVoiceFields`-493`); delete of a different active still forces browser merge and keeps leaves ` stashcurrent (.voice.localModelAutoCorrectedFrom`. Pinned at test `:611`.

### C. stashed modeloriginal now ready → restore preference), + which is clear; consistent skip with restore-on-ready.  
- ` further correction?

[inspected] **Restore yes; skip-correction is coded but weakly tested.**

```208:213get_state` / download interleaving:companion/src/voice/whisper: both- writeshandlers are synchronous.ts
 `setVoiceFields    const`; JS cannot split a stashed = cfg.localModelAutoCorrectedFrom
    if (stashed && probeModel(deps, st stashashed).status === write. Download `finally` may run during `await statePayload` — config ends consistent "ready") {
      setVoiceFields({ localModelId: stashed,; localModelAutoCorrectedFrom: undefined })
      logger.info("voice.model.get_state.auto_correct_ payloadrestored", can { restored: st beashed })
      one tick return stale (
UI    }
```

The flicker only).  
 `return` skips- Stash written the correction and block never cleared if. The self the user- staysheal on test (` `browser` forever: leftover config key, not preference loss.

**2. Config hygiene** — no:632`) probes **all** ids `ready`, so a missing `return` would still no-op at `: functional215` (`probe finding ((activetestId gap =)` on the ** NstIT above)ale** `cfg  
- Field is on.localModelId `VoiceConfig`, === omitted from `DEFAULT "small"_CONFIG`,`, also ready). round-trips via It deepMerge when does **not** present.  
- pin “do Tamper: non not cl-union valuesobber the restored id.”

### D `. download of stdelete`dashed model completes on load.  
- → restore + return ` (Aundefined`1 merge must: stringify not run)

 drops on disk; cache is[ `insundefined`;pected] **Yes, if probe ` saysif (stashed ready.**

``` &&168:178 …:companion/src)` is false.

/voice/whisper**3. ADR--022handlers note.ts vs
function shipped dual maybeAuto-ActivatetrackModel** — no finding  
(modelId:- `denyOutbound WhisperModelId,ExfilIfNeeded deps: VoiceModel`:HandlerDeps): void ` {
   grant_id` const stashed = → `grantAll cfg?.localModelowsPageExportByAutoCorrectedFromId`; else
    if ( `grantAllowsPagestashed && probeModel(deps,Export(caller stashed).status ===)` " (`readycompanion")/src/outbound- {
      setVoiceFieldsmcp/({fac localadeModel.ts:70Id: stashed-79, localModelAuto`).CorrectedFrom:  
 undefined })
     - HTTP invoke: ` loggergrant.info("voice.model.auto_correct_rest_id: auth.mode ===ored "",grant {" restored ?: stashed, auth.grant_ trigger: modelIdid : undefined` }) —
      return never
 body    }
``` (`companion-http

A1 (`.ts:737setVoiceFields({-745 localModelId:`). Per modelId })`-key deny runs at `:185`) first so a is after sibling flagged grant cannot authorize that this key (`: return. Pinned by test `:447-454677` (`large`).  
- HITReady` flippedL: inside `acceptOutboundDisclosure(caller_id `downloadImpl`).)` (`companion

### E.-http.ts: download of a *219different* model,`); ` stash exists, sthasOutboundDisclosure(ashed not ready

cid)` on both tracks (`fac[inspected]ade.ts:99 **A`).  
- `1 still runs ifdisclosure_accepted` active ignored (`fac is not ready;ade.ts:151-154 stash is not cl`).  
- Callerobbered.** Restore bind `: `GRANT_if` fails;CALLER_MIS A1 writesMATCH` (`companion-http.ts: only `{725 localModelId-735`).  
:- Default `outbound modelId }_mcp.require_`; spreadgrant:- true` (`config.ts:422`)merge keeps the so production stash. If active HTTP is grant- **is** readyonly, A1 returns; ADR’s at “HTTP = `:184` — per-key” stash matches shipped kept default.

, downloaded**4. ADR-023（ id not activated二） `. **UntsttEngine`ested.**

### vs combined F. Double restore delete** — no ( finding  
- Autoget paths only_state + write `local maybeModelId` /AutoActivate)

[ stash (`maybeinspected] **AutoNo resurrectionActivate,Model no` double `:175, flip in Node185.** Both critical sections`; `autoCorrect are synchronous (`ActiveLocalModel`get `:210,220Config` + `-probe224`).` +  
 `-set Delete includesVoiceFields ``).st `tEnginesaveConfig`/`: "browser"` **setVoiceFields`only have** no when yield ` (stconfigtEngine === ".ts Hlocal" && was5 comment ~Active`129 (`:490-4).493 Wh`). Stash-only deleteichever runs first:

 does- Restore not flip engine ( first → stashtest `:742 `-743`).

**undefined`5. Regression → later of ` existing guarantees** — no finding  
-autoCorrect` sees `set_engine no stash; local` still returns restored `NO_READY id_MODEL` before probes ready → return any.
- Correct ` firstsetVoice (Fieldsstash` not (`:573-579 ready) → download`; complete test `:174- then restore189`).  
-. Delete-active still Final = forces browser (`: restored.

After483-499`; test `:442 clear, a-467 new stash is only`).  
- A written from1 still does ** not writecurrent** `cfg `sttEngine.localModelId` (`:185``; tests if that id `:503 later-504, probes :541`). not-ready.

---

## That is re VER-stashDICT: of **BLOCK** a failed

One MAJOR: the restore restore machine, not resurrection does of not the implement old its value.

### G. own “don’t stash set_ defaultactive medium clears stash unconditionally” rule, so

[ theins commonpected first-run path] **Yes — same will id as current, and setting the stashed silently move a id.**

```542:542 working `small` back to `medium` when the recommended weights finish:companion/src downloading. Fix/voice/whisper the-handlers.ts
 stash      setVoiceFields predicate (or strike({ localModelId the claim: modelId, from ADR-023 localModelAutoCorrect / comments) beforeedFrom: undefined treating })
```

 MAJORTest `:-A as704` only covers closed. a third NI idTs (` are notmedium`). Same-id / independently set blocking.-stashed-id untested; code has no branch.

### H. delete

[inspected]

```485:494:companion/src/voice/whisper-handlers.ts
        const wasActive =
          cfg?.localModelId === modelId ||
          (cfg?.localModelId == null && modelId === "medium")
        const clearStash = cfg?.localModelAutoCorrectedFrom === modelId
        if ((cfg?.sttEngine === "local" && wasActive) || clearStash) {
          setVoiceFields({
            ...(cfg?.sttEngine === "local" && wasActive ? { sttEngine: "browser" as const } : {}),
            ...(clearStash ? { localModelAutoCorrectedFrom: undefined } : {}),
          })
```

| Case | Behavior |
|---|---|
| Delete stashed, not active | Clear stash only; engine untouched. Tested `:723`. |
| Delete active **and** stashed | One write: `sttEngine: "browser"` + stash `undefined`. **Untested.** |
| Delete active, **not** stashed, `engine=local` | `{ sttEngine: "browser" }` only — **still forces browser**; leftover stash kept. Existing test `:442` has no stash. |

### I. set_engine local

```582:620:companion/src/voice/whisper-handlers.ts
      let activeId = (cfg?.localModelId ?? RECOMMENDED_WHISPER_MODEL) as WhisperModelId
      ...
      if (!ready.includes(activeId)) {
        if (cfg?.localModelId && isWhisperModelId(cfg.localModelId)) {
          overrideFrom = cfg.localModelId
        }
        ...
      }
      ...
      setVoiceFields({
        sttEngine: "local",
        localModelId: activeId,
        ...(overrideFrom && !cfg?.localModelAutoCorrectedFrom
          ? { localModelAutoCorrectedFrom: overrideFrom }
          : {}),
      })
```

| Case | Result |
|---|---|
| Explicit configured, not in `listReady` | Stash it; pick recommended-if-ready else `ready[0]`. Tested `:746`. |
| `localModelId` unset | `overrideFrom` not set (`cfg?.localModelId` falsy). Not stashed. |
| Already stashed | `!cfg?.localModelAutoCorrectedFrom` false — no overwrite. |
| Configured **is** ready | No override; no new stash (leftover stash preserved). |
| `ready.length === 0` | Return at `:575` **before any write** (stash + engine untouched). Tested without stash `:174`. Zero-write **with stash present** untested. |

Probe second belt (`:599–611`) can still refuse after override; that path also writes nothing.

### J. Defaults / `explicit && !stashed`

[inspected] Confirmed: correction uses coalesced `activeId = cfg.localModelId ?? RECOMMENDED` (`:214`) but stashes **raw** `cfg.localModelId` (`:219–223`). Unset/`undefined` is not stashed; `"medium"` is truthy and **would** be stashed. After `getConfig`/`deepMerge`, omitted `localModelId` is filled to `"medium"`, so the unset branch is dead at runtime. (Not re-litigated as a defect.)

### K. Restore of a not-actually-ready model (probe vs listReady)

[inspected] Both restore sites use **only** `probeModel`, never `listReady`. Production `listReadyWhisperModels` (`whisper-state.ts:205–212`) is a loop over the same `probeWhisperModelDir`. `set_active` uses the same probe bar. Injected test deps can diverge; production cannot restore a hash-failed dir.

`probeWhisperModelDir` returns `absent` for unknown ids (`whisper-download.ts:285–287`), so an invalid stash will not restore.

### L. Stash of a non-`WhisperModelId`

[inspected] Writers: `cfg.localModelId` (load-coerced) or `isWhisperModelId`-checked `overrideFrom`. Load-time:

```941:948:companion/src/config.ts
    if (voice.localModelAutoCorrectedFrom !== undefined) {
      const m = voice.localModelAutoCorrectedFrom
      if (m !== "small" && m !== "medium" && m !== "large-v3-turbo") {
        ...
        delete voice.localModelAutoCorrectedFrom
```

---

## Config

**Survive save/load?** [inspected] Yes for a valid id. `setVoiceFields` copies the whole `voice` object (`config.ts:1118–1142`); `JSON.stringify` keeps the string; `saveConfig` `deepMerge` preserves the key if a later patch omits it. `defaultConfig.voice` does not include the field, so load will not resurrect it.

**Tamper:** [inspected] Invalid value is `delete`d on the **in-memory** `cachedConfig.voice` only. **No `saveConfig`.** Disk stays dirty until the next `setVoiceFields`/`saveConfig` (same as other voice coerces).

**`setVoiceFields({ localModelAutoCorrectedFrom: undefined })`:** [inspected] Spread **does** overwrite the previous string with `undefined` (key remains on the in-memory object). `toSave = JSON.parse(JSON.stringify(updated))` drops it on disk. `cachedConfig = updated` (not `toSave`), so until mtime reload, `in` is true and the value is `undefined`. All handler reads use truthiness (`if (stashed)`, `!cfg?.localModelAutoCorrectedFrom`) — equivalent to deleted. Does **not** leave the previous id.

---

## Tests (the new stash/restore block)

| Test | Pins claimed semantic? |
|---|---|
| `:595` stashes explicit | **Yes.** Would fail if stash not written. |
| `:611` does not overwrite stash | **Yes.** Second correction still moves `localModelId`; stash stays `large-v3-turbo`. |
| `:632` self-heal restore + clear | **Partial.** Pins restore + clear. Does **not** pin skip-correction after restore (see C). |
| `:652` **"download completion restores stashed preference once that model is ready"** | **Name lies.** Body comment and asserts are the opposite: probe still `absent` → **no** restore, stash kept. Would also pass if `maybeAutoActivateModel` were a no-op (asserts no change). Catches a restore that **ignores** probe. Does **not** pin restore-on-ready. |
| `:677` download of stashed model restores | **Yes.** `largeReady` flipped in `downloadImpl`; this is the real download-restore pin. |
| `:704` set_active clears stash | **Yes.** Only a third id, not same-id / stashed-id. |
| `:723` delete stashed clears stash | **Yes** for non-active delete. Does not pin active+stashed combined write. |
| `:746` set_engine stashes override | **Yes.** |

**Missing (as requested):**

- `set_engine` zero-write **with stash present**
- delete **active + stashed** combined
- get_state when stash not ready **and current active IS ready** (steady state: must not correct, stash remains) — code `:215` does this; untested
- maybeAutoActivate of a **non-stashed** model while stash exists

---

## Findings

### MAJOR

1. **`companion/tests/voice-whisper-handlers.test.ts:652`** — Test title claims restore-on-ready; body asserts **no** restore because probe stays `absent`. Vacuous w.r.t. “restore ran.” Real restore is only pinned at `:677`. Rename to match the body (e.g. “does not restore while stashed model still probes absent”) or flip probe after `downloadImpl` like `:677`.

### NIT

2. **`whisper-handlers.ts:208-212` + test `:632`** — Skip-correction after restore is an early `return`, but the test probes every id `ready`, so deleting the `return` would still pass. Pin with: stash ready, **current active not ready**, assert restored id not replaced by `AUTO_ACTIVE_PRIORITY`.

3. **`whisper-handlers.ts:179-185` (E)** — Downloading a non-stashed model while stash exists and active is not ready still A1-activates the download and keeps the stash. Intended, untested.

4. **`whisper-handlers.ts:490-494` (H)** — Combined delete of active+stashed is one `setVoiceFields`; untested. Delete-active-not-stashed still forces browser (spreads are independent).

5. **`whisper-handlers.ts:575-579` (I)** — Zero-write on `ready.length === 0` precedes stash logic, so an existing stash is preserved; untested with stash present.

6. **`whisper-handlers.ts:168-177` vs `:204-207`** — Download restore does **not** require `sttEngine === "local"`; get_state restore does. A download complete while engine=browser will rewrite `localModelId` to the stash. Matches ADR “once ready”; worth a one-liner in ADR-023 if that surprise is unwanted.

7. **No `voice-config.test.ts` case** for `localModelAutoCorrectedFrom` round-trip / tamper-delete. Logic is in `getConfig`/`setVoiceFields` but unexecuted in that file.

### Not a defect (explicitly not re-litigated)

- config.json-backed stash vs process memory  
- `JSON.stringify` dropping `undefined`  
- default `"medium"` vs unset  
- ADR-022 grant-semantics docs  

---

No BLOCK: stash is written only on explicit override, not overwritten, cleared on restore / `set_active` / delete-stashed, and restore is gated on `probe === "ready"` (same as `set_active`). Fix the lying test and add the four missing pins before treating this as locked.Independent adversarial review of HEAD `6e5083fb` + the five-file working-tree diff. Four lanes ran in isolation (ARCHITECTURE / CORRECTNESS / SECURITY / PRODUCT-UX); this report synthesizes them against the code, ADR, and a fresh companion test run.

**Blast tier:** T2 (voice preference restore) + T0 (ADR-022 docs-only). No outbound gate code in the diff.

---

## Verdict: **PASS_WITH_NITS**

MAJOR-A (one-way auto-correct) is closed for explicit catalog IDs. MAJOR-B (ADR-022 shipping-gate sync) is closed and matches the shipped dual-track gate. No BLOCK/MAJOR remains after calibrating two over-grades from the lanes (see below).

Machine: `companion` suite **3953 pass / 0 fail** (includes all 8 new A2 tests and the existing A1 / `set_engine` zero-write / delete-active / `privacy_ack_v2` pins). `[executed]`

---

## What actually landed

| Claim | Result |
|---|---|
| `get_state` stashes explicit `localModelId` before overwrite | Yes. `whisper-handlers.ts:219-224` |
| Existing stash is not overwritten | Yes. `explicit && !stashed` / `!cfg?.localModelAutoCorrectedFrom` |
| Restore only when `probe === "ready"` | Yes. Both restore sites use `probeModel`, never `listReady` |
| `set_active` / delete-of-stash clear | Yes. `542`, `488-494` |
| A1 never writes `sttEngine` | Yes. `175`, `185` |
| `set_engine local` zero-write when no ready model | Unchanged; still returns before any `setVoiceFields` (`573-579`) |
| Delete-active still forces browser | Combined write; stash-only delete does not flip engine |
| ADR-022 L4+ note vs `denyOutboundExfilIfNeeded` / HTTP Bearer | Accurate (see Security) |

`setVoiceFields({ localModelAutoCorrectedFrom: undefined })` does drop the key on disk (`JSON.parse(JSON.stringify)` at `config.ts:1132-1138`). In-memory cache keeps `undefined`; all readers use truthiness. Matches the stated idiom.

Restore and auto-correct are synchronous `setVoiceFields` with no yield. Node cannot interleave a double-restore or resurrect a cleared stash in one turn.

---

## Findings

### NIT-1 — ADR/comments claim “defaults are not stashed”; `getConfig()` never has an unset `localModelId`

- `companion/src/config.ts:527-532` — `defaultConfig.voice.localModelId` is always `"medium"`.
- `companion/src/config.ts:864-888` — missing/illegal voice block coerced to `"medium"`.
- `companion/src/voice/whisper-handlers.ts:219-223` and `:587-590` — stash predicate is truthy `cfg.localModelId`.

After load, `explicit && !stashed` cannot see “unset.” The comment and ADR-023 修订（二） overclaim a state the schema does not represent.

This is **not** the original MAJOR-A (lost explicit `large-v3-turbo`). That path is pinned. The architecture lane’s “first-run yank `small → medium`” is also weaker than stated: download completion A1 (`maybeAutoActivateModel`, `:179-185`) already moves `localModelId` off default medium when medium is not ready, **before** `set_engine local`, so the common “download small, then enable local” path never stashes medium.

**Fix:** strike “默认/未显式设置不暂存” or say “only a configured catalog id is stashed; factory default is indistinguishable from an explicit `medium` after load.” Do not invent a tri-state unless product wants one.

### NIT-2 — Test title does not match assertions

`companion/tests/voice-whisper-handlers.test.ts:652-674` is named “download completion restores stashed preference once that model is ready” but the body keeps probe `absent` and asserts **no** restore. Real restore-on-download is the next test (`:677-701`). The negative test is useful (don’t restore if probe isn’t ready); the name is a maintainer trap.

Rename to “does not restore while stashed model still probes absent.”

### NIT-3 — Tamper/round-trip of the new field is untested

Load-time allowlist exists (`config.ts:941-948`) in the same shape as `localModelId`. `companion/tests/voice-config.test.ts` has no `localModelAutoCorrectedFrom` case (illegal value deleted; legal value survives save/load; `setVoiceFields(undefined)` drops the key on disk after `clearConfigCache`). Handler tests never re-read disk.

### NIT-4 — Self-heal test does not pin “skip correction after restore”

`whisper-handlers.ts:208-213` returns after restore. The test at `:632` probes **every** id `ready`, so a missing `return` would still no-op at `:215` (`small` is ready). Pin with: stash ready, **current** active not ready, assert restored id is not replaced by `AUTO_ACTIVE_PRIORITY`.

### NIT-5 — A few restore edges are unpinned (code is consistent)

| Edge | Code | Test |
|---|---|---|
| Delete active **and** stashed in one write | `490-494` combined spread | No |
| `get_state` when stash not ready and current active **is** ready | `:215` return | No |
| A1 of a non-stashed download while stash exists | `:185` does not touch stash | No |
| `set_engine` zero-write **with stash present** | `:573-579` before any write | Existing zero-write test has no stash |

Not vacuous holes in the eight new tests: six of eight actually pin their claim. The misnamed one pins the negative path.

### NIT-6 — ADR-023 body lag

Header 修订（二） (`docs/adr/023-voice-local-stt-path-b.md:7`) matches the restore rules. §6 config table and §13 修订记录 were not updated. Live SoT is the header.

---

## Security / ADR-022 (MAJOR-B)

Docs-only; `companion/src/outbound-mcp/**` is untouched. The L4+ note matches shipped code:

| ADR claim | Evidence |
|---|---|
| HTTP per-key via authenticated `grant_id` | `companion-http.ts:737-745` — `grant_id` from Bearer grant, never body; `facade.ts:77-78` → `grantAllowsPageExportById` |
| stdio per-caller | `facade.ts:79`, `bridge.ts:110` — no `grant_id` → `grantAllowsPageExport(caller)` |
| HITL still per-caller on both tracks | `facade.ts:99` `hasOutboundDisclosure(cid)` |
| `disclosure_accepted` / HTTP ack ≠ consent | `facade.ts:151`; HTTP `ACK_NOT_OPERATOR` at `companion-http.ts:695-703` |
| `GRANT_CALLER_MISMATCH` | `companion-http.ts:725-735` |

Default `outbound_mcp.require_grant: true` (`config.ts:422`) so production HTTP is grant-only. Impl-map Grant row is “代码路径”, not “P1 product shipped.” Line ~190 maintenance gate is satisfied.

Restore / A1 never write `sttEngine`. `set_engine local` still requires `privacy_ack_v2` before any write. Stash is never taken from a WS field.

---

## Lane calibration (independent)

| Lane | Their verdict | Kept? |
|---|---|---|
| ARCHITECTURE | BLOCK (default-medium MAJOR) | Downgraded to NIT-1. Spec overclaim is real; the “primary install yank” is preempted by A1 on download. |
| CORRECTNESS | PASS_WITH_NITS (lying test as MAJOR) | Lying title is NIT-2, not MAJOR. Body is a real negative pin, not vacuous. |
| SECURITY | PASS_WITH_NITS | Agree. |
| PRODUCT-UX | BLOCK (lying test as MAJOR) | Over-grade. Test names are not merge-blocking when the next test pins restore. |

Original MAJOR-A (explicit choice lost) and MAJOR-B (ADR-022 unsynced) are **closed**. Residual is documentation/test hygiene.

---

## Eval-engineering card

```text
Blast tier: T2 (voice) + T0 (ADR docs)
MACHINE: PASS  — companion 3953/0, new A2 tests green
ADVERSARY: APPROVE_WITH_NITS
VERDICT: PASS_WITH_NITS
MERGE: not claimed by this reviewer (Pi 复审 still required for T2)
```

Nits can ride a follow-up. Nothing here re-opens preference-loss or misstates the exfil gate.
