# S51 Security Lane

**Range**: `6d2cdcf..HEAD` (tip `14e1b28`)  
**Themes**: #126 Trust B lifecycle · #127 Thread History IA · #128 shell_exec abort · #129 voice M1 · #130 analyze_image data: · #131 settings accordion + context budget  
**Mode**: adversarial, fail-closed only on real user-reachable issues  
**Evidence tags**: `[inspected]` live tip · `[assumed]` not re-executed tests this session  

## Verdict: REQUEST_CHANGES

Primary S46 Trust P0s (restore-on-leave, install strip, spawn `allowTrust:false`, failure rollback, journal, single-holder for **active** threads) **HOLD**.  
**New cross-PR hole**: soft-delete / recycle-bin paths retain `mission_pack_trust_snapshot` and re-invoke `releaseTrustBeforeThreadGone` on permanent delete / unapply-after-restore, which can **silently re-apply a pre-apply security cookie** (including re-enabling cruise flags the user later turned off). That is a real product security lifecycle defect spanning #126 × #127.

---

## Confirmed HOLDS (prior fixed, still good)

| S46 P0 / residual | Status | Live evidence |
|---|---|---|
| **P0-1 Restore on leave** | **HOLD** | `unapplyPack` / `uninstallPack` / switch-away in `applyPack` call `restoreTrustSnapshot` / `restoreTrustFromThreadCookie` before clearing cruise. `[inspected]` `companion/src/packs/pack-engine.ts` ~1232–1237, 1474–1481, 1507–1527 |
| **P0-2 Post-trust failure rollback** | **HOLD** | `trustJustWritten` + `rollbackTrust` on blocked / assets fail / patch fail; journal cleared. `[inspected]` ~1288–1317, 1364–1368, 1434–1438 |
| **P0-3 Install strip** | **HOLD** | `sanitizeManifestForInstall` + rewrite + defense-in-depth re-check after rename. `[inspected]` `installPackFromDirectory` ~1019–1047 |
| **P0-4 spawn `allowTrust:false`** | **HOLD** | Default `allowTrust === true` only; spawn path hard-codes `false`. UI `pack.apply` passes `true` only with `user_gesture`. `[inspected]` `server.ts` ~3281–3292, `message-router.ts` ~2412–2416, `applyPack` ~1225 |
| **Single-holder (active)** | **HOLD** (active list only) | `findOtherTrustHolders` + `trust_holder_conflict`. `[inspected]` ~1248–1261, 301–312 |
| **Crash journal + boot reconcile** | **HOLD** | `mission-pack-trust-journal.json` applying→held; `reconcilePackTrustOnBoot` on init. `[inspected]` ~255–357, `server.ts` ~563–570 |
| **analyze_image data: residual** | **HOLD** | Local decode + MIME allowlist + 6 MiB; **no** phase-2 fetch; schemeOk never expanded to `data:`; log summarizer truncates payload. `[inspected]` `image-data-url.ts`, `server.ts` ~2462–2525; extension `promoteFetchSrc` promotes data:→canvas |
| **shell abort / process tree** | **HOLD** | Registry + `killProcessTree` (POSIX `-pid` SIGKILL / win32 `taskkill /T /F`); wired on `chat.abort` / `stop_thread` / `shell.exec.abort` / AbortSignal; pre-abort refuses spawn. `[inspected]` `shell.ts`, `server.ts` ~6449–6489 |
| **LLM chat on trashed** | **HOLD** | `chat.create` rejects `thread_trashed`. `[inspected]` `message-router.ts` ~523–536 |
| **Context budget disk integrity** | **HOLD** | Request-path head-drop only; omit notice states disk retained; M2 uses redacted transcript. `[inspected]` `context-budget.ts`, `context-budget-m2.ts`, `adapter.ts` ~484+ |

---

## Findings

### F1 — HIGH — Trust cookie survives soft-delete; permanent delete / later restore can re-elevate cruise

| Field | Detail |
|---|---|
| **Where** | `companion/src/message-router.ts` ~1177–1207, 1215–1274; `companion/src/packs/pack-engine.ts` `releaseTrustBeforeThreadGone` ~391–409; `companion/src/threads/thread-manager.ts` `trash`/`restore` ~377–396; UI hard-delete from trash `chrome-extension/src/sidepanel/components/ThreadList.tsx` ~273–292 |
| **Evidence** `[inspected]` | (1) Soft-delete (`mode:"trash"`, product default) calls `releaseTrustBeforeThreadGone` → restores globals from cookie **but leaves `mission_pack_trust_snapshot` on the thread**. (2) `trash()` only sets `trashed_at`; does not clear pack/trust fields. (3) Permanent delete from recycle bin calls `releaseTrustBeforeThreadGone` **again** with the same stale cookie. (4) `findOtherTrustHolders` uses `threadManager.list()` which **excludes trashed**, so a trashed Trust thread does not block a second active Trust apply — then hard-delete of the trashed thread still re-applies the first cookie. |
| **User impact** | Reachable power-user path after #127 recycle bin + #126 Trust B: **Manual cruise ON → apply Trust scene → move scene thread to trash (cookie keeps pre-apply ON) → user turns cruise OFF in Settings → open 回收站 → 永久删除** → `restoreTrustSnapshot(cookie)` **re-enables `auto_approve_dangerous` / related flags without a new pack.apply gesture.** Reverse: second active Trust scene’s elevation can be clobbered to an older baseline when purging an unrelated trashed Trust thread. Restore-from-trash reintroduces a phantom holder cookie without re-applying elevation (availability / UI honesty). |
| **Real vs theoretical** | **Real** — default delete is trash; trash view hard-delete is an explicit UI path with confirm. Not LLM self-raise; **silent residual Trust write** on a lifecycle the user frames as “delete conversation”. |
| **Fix direction** | On first Trust release (trash / delete / cleanup): restore globals **and null `mission_pack_trust_snapshot`** (and pack id if product wants full leave). Make `releaseTrustBeforeThreadGone` idempotent (e.g. clear cookie after restore, or journal “released” bit). On hard-delete of already-trashed: **do not** re-restore. Optionally `findOtherTrustHolders` should treat retained cookies consistently if cookies are kept for restore. Add regression tests: trash→settings toggle→hard-delete; trash A→apply B→hard-delete A. |

### F2 — MED — Soft-delete retains full thread payloads on disk (incl. tool results); history.db intentionally not purged

| Field | Detail |
|---|---|
| **Where** | `thread-manager.trash` keeps message JSON files; `thread.batch_delete` comment “history.db ops intentionally retained”; `purgeExpiredTrash` 30d lazy |
| **Evidence** `[inspected]` | Soft-delete is reversible by design; messages readable via `thread.select` with `trashed:true`. history redaction exists for cookie tools on write, but conversation files under `~/.cmspark-agent/threads/` keep full agent history. |
| **User impact** | “Delete” in UI is not erase until permanent delete or 30d TTL. Shared-machine / forensic residual. Matches recycle-bin product intent if UI copy is honest (confirm text does mention restore). |
| **Real vs theoretical** | **Real retention**, **not** cross-origin leak. Severity MED only if users believe trash ≈ wipe; demote if copy is clear. |
| **Fix direction** | Optional “清空并销毁” hard path already exists; ensure copy never says 删除数据 permanently for trash. Consider scrubbing secrets on trash (product call). |

### F3 — LOW — Voice M1 sends audio to browser vendor SpeechRecognition (disclosed)

| Field | Detail |
|---|---|
| **Where** | `useVoiceInput.ts`, `voice-permission.tsx`, privacy modal in `App.tsx` ~1100+ |
| **Evidence** `[inspected]` | Privacy ack gate + settings toggle; transcript merges into draft only (no auto-send); permission bootstrap is extension page; audio path is Web Speech / Chrome, not Companion. |
| **User impact** | Expected browser STT privacy surface once user acks. No new Companion trust elevation. |
| **Real vs theoretical** | Real data path, **accepted product surface** with ack. Not a bypass. |

### F4 — LOW — Context compaction can drop LLM context; disk/UI may still show full history

| Field | Detail |
|---|---|
| **Where** | `llm/context-budget.ts`, `adapter.ts` runtime compact |
| **Evidence** `[inspected]` | Omit notice + “Full history retained on disk”; M2 redacts cookies/shell/host tools and secret-shaped strings before summary LLM. |
| **User impact** | Agent may forget earlier constraints → behavioral miss, not silent privilege raise. Mode `prompt`/`off` available. |
| **Real vs theoretical** | Product correctness / safety-of-agent, not authn/z vuln. |

### F5 — LOW — `shell.exec.abort` / kill tree residual platform edges

| Field | Detail |
|---|---|
| **Where** | `killProcessTree`, `detached:true` on POSIX |
| **Evidence** `[inspected]` | Tests cover AbortSignal, per-thread/id abort, grandchild timeout on POSIX. win32 uses `taskkill /T /F` fire-and-forget. Auth required before non-handshake messages. |
| **User impact** | Stop should kill approved shell trees; residual orphan risk on exotic spawn failures is low. |
| **Real vs theoretical** | Mostly held; residual theoretical on PID reuse / non-group-leader edge cases. |

---

## User-perspective filter notes (demoted / not FAIL-CLOSED)

| Candidate | Why demoted |
|---|---|
| data: SSRF / phase-2 bypass | Residual path decodes locally; never expands `schemeOk` to data:; extension promotes data:→canvas; `analyze_image_fetch` direct call blocked. Prior P0s still good. |
| Install origin spoof + trust | Still stripped on install; only `saveUserPack` authors origin=user + trust. |
| spawn Trust elevation | `allowTrust: false` on spawn applyPack. |
| Sticky cruise on uninstall/switch (S46 F1) | Fixed on primary leave paths; **new** issue is soft-delete cookie lifetime (F1 this report), not uninstall. |
| Voice as remote RCE / Companion exfil | STT→draft only; no tool surface expansion. |
| Context budget “silent data loss” as security | Request-only; honest omit notice; secrets redacted for M2. |
| Soft-delete “data leak” to network | Local disk only; no new WS broadcast of message bodies beyond normal thread select. |
| `user_gesture:true` spoof over WS | Authenticated local peer threat model unchanged; not introduced by this range. |
| MIME polyglot images via data: | Vision-bound bytes; no browser script execution in companion residual path. |

---

## Recommendation

1. **Block close of Trust×History interaction until F1 is fixed** (or document + hard-disable Trust release re-entry): clear trust cookie on first release; never double-restore on hard-delete-from-trash; add tests for trash→settings flip→permanent delete and trash A→Trust B→purge A.  
2. **Do not reopen** data: IMAGE_FETCH, shell process-tree abort, install strip, or spawn allowTrust — those hold at tip.  
3. Ship voice M1 / context budget / shell abort as security-OK once F1 addressed (or explicitly accepted with user-facing warning — not recommended).  
4. Re-run targeted tests after F1: `packs-engine.test.ts`, `thread-batch-delete.test.ts`, `thread-cleanup-context.test.ts`, plus new trash×trust cases.

---

VERDICT: REQUEST_CHANGES
