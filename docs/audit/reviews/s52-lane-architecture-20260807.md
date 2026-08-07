# Architecture Lane — S52 post-ship multi-adv
**Range**: 14e1b28..d34bac2
**Recommendation**: PASS_WITH_NITS
**Architectural status**: CLEAR

**Evidence**: `[inspected]` live tip sources + `docs/audit/reviews/s52-main-pull-diff-20260807-090154.patch` · prior S51 multi-lane + S51 architecture lane · ADR-020 checklist. No `[executed]` test run in this lane.

**Themes in range**: Trust trash cookie lifecycle (#132 / S51 P0-1) · mid_loop M2 request re-attach (S51 P0-2) · packaging version SoT · nits (voice OS copy, hard-delete broadcast).

---

## Findings

### F1 — Trust soft-delete cookie ownership is now coherent (closes S51 Arch F1 / multi-lane P0-1)
**Severity:** **INFO** (resolved)  
**Where:** `companion/src/packs/pack-engine.ts` `releaseTrustBeforeThreadGone` · `clearTrustCookieWithoutRestore` · `message-router.ts` delete/trash/batch/cleanup/list

**Architecture assessment:** S51 Architecture blocked on incomplete Trust exit matrix: soft-trash restored globals but left `mission_pack_trust_snapshot` as a live ownership token → dual-holder / hard-delete re-restore / clobber of live holder B.

Tip model is coherent:

| Path | Restore globals? | Clear cookie? | Journal |
|------|------------------|---------------|---------|
| Soft-trash (release **before** `trash()`, no `trashed_at`) | Yes | Yes (persist via `threadManager.update`) | Match-clear |
| Hard-delete from trash (`trashed_at` set) | **No** (`alreadyTrashed` branch) | Yes if leftover | Match-clear |
| Hard-delete active | Yes | Yes | Match-clear |
| Pre-S51 leftover cookie on trash + `thread.list` | **No** (`clearTrustCookieWithoutRestore`) | Yes | n/a |
| Second release after clear | no-op (`isPackTrustSnapshot` false) | — | — |

Cookie presence again approximates **active Trust ownership** for active threads. `findOtherTrustHolders` still uses `list()` (excludes trash); with cookie cleared at soft-trash, that exclusion no longer hides a dual writer. Tests cover: cookie clear + idempotent second release; trash → Settings OFF → hard-delete no re-elevate; trash A → apply B → hard-delete A does not clobber B; migration clear-without-restore.

**Invariant (post-#132):** `mission_pack_trust_snapshot ≠ null` ⇒ this thread is (or was, only until next successful release) the Trust holder; soft-trash retires the cookie as ownership token, not only the process-global cruise.

---

### F2 — Soft-trash still splits Composition attach vs Trust packaging (residual, non-blocking)
**Severity:** **LOW** (product honesty / control-plane clarity; was S51 Arch F3 MED)  
**Where:** soft-delete calls `releaseTrustBeforeThreadGone` then `trash()` only — does **not** `unapplyPack`

**Architecture issue:** After soft-trash of a Trust-holding thread:
- Trust globals restored + cookie null + journal cleared ✅  
- `mission_pack_id` / whitelist / skills / `system_prompt_append` remain on the index row  

On restore-from-trash, the conversation reappears “still wearing” the Pack composition without Trust elevation or re-consent. That is **not** a dual-holder / cruise clobber hole (cookie is gone; unapply no longer fires stale restore). It is a user-model split: “对话进回收站” vs “场景配方还在、Trust 已卸”.

**Ask (optional, not merge-blocking):**
1. Soft-trash Trust holder → `unapplyPack` then trash (stronger honesty), **or**
2. Keep composition but UI-label restored threads as “场景仍挂 · Trust 已释放”; refuse silent re-elevate without apply gesture (already true: re-elevate needs `allowTrust:true`).

Do **not** re-plant cookie on restore without user apply + single-holder.

---

### F3 — mid_loop M2: dual-truth closed for LLM request vs UI meta
**Severity:** **INFO** (resolved S51 P0-2)  
**Where:** `companion/src/llm/adapter.ts` `runContextBudgetPass` · `attachRollingSummaryToMessages` · `shouldRunM2(..., "mid_loop") === false`

**Architecture assessment:**

| Layer | Pre-S51 mid_loop | Tip mid_loop |
|-------|------------------|--------------|
| Disk messages | Untouched | Untouched |
| UI `runtime_context_budget.rolling_summary` | Kept (Pi meta nit) | Kept |
| **LLM request messages** | M1 plain omit only — **dual-truth** | Re-attach prior summary → `mode = "m2"` |
| Event `thread.context_compacted.mode` | Could disagree with kept meta | Agrees with re-attach (`m2`) |

Intentional remaining dual-truth is **request-path compact vs full disk history**, with banner / Settings control — honest product feature (L0 request path; not Composition rewrite). Dishonest dual-truth was **UI「查看摘要」≠ model context**; that is fixed by re-attach when `phase === "mid_loop" && keepSummary && mode === "m1"`.

`shouldRunM2` still refuses mid_loop **generation** (latency); re-attach is the correct architectural substitute. `attachRollingSummaryToMessages` replaces omit notice in-place (single notice).

**Residual quality (not architecture hole):** re-attached text is pre_loop summary; newly dropped mid_loop tool mass is not re-summarized. Preferable to wipe; document as quality, not mode lie.

**Nit:** `tokens_after` in log/event still reflects pre-reattach compact size — minor metric honesty only.

---

### F4 — Packaging version SoT is good architecture with small residuals
**Severity:** **LOW** (nits)  
**Where:** `companion/package.json` · `scripts/build-windows-exe.ps1` · `create-dmg.sh` · `package.sh` · `installer.nsi` · `scripts/macos/Info.plist` · `AGENTS.md` · gates in `scripts/tests/test-package-gates.sh`

**Assessment:** Single SoT = `companion/package.json` version is the right packaging architecture:
- Windows SEA zip/installer injects version from package.json; NSIS via `/DPRODUCT_VERSION=`
- macOS Info.plist uses `__CMSPARK_VERSION__` placeholder + stamp assert (kills `sed s/0.2.0/` trap)
- package.sh already required package.json; comments document lock-step with chrome-extension
- Static gates assert placeholder + no hardcoded 0.2.0 artifact names + NSIS override

**Residuals:**
1. `installer.nsi` fallback `PRODUCT_VERSION "0.4.0"` still hardcoded for manual `makensis` — will drift next bump unless CI always injects `/D`. Acceptable with comment “must match companion/package.json”.
2. `companion/src/index.ts` usage banner hardcodes `v0.4.0` — not packaging SoT, but CLI identity can lag SoT (nit: read from package.json at build/print).
3. chrome-extension version is lock-step by policy + warning, not a hard build fail if only companion bumps — correct for dual-package product; warning in ps1 is enough.

Not a second version runtime; not Surface/Trust.

---

### F5 — ADR-020 / docs lifecycle string lags code (Trust trash)
**Severity:** **LOW** (docs drift)  
**Where:** ADR-020 Composition rule 2 lifecycle sentence; architecture.md (no soft-delete Trust mention found)

ADR-020 lists Trust restore exits: unapply / uninstall / switch-away / apply fail + install strip. Code also treats **thread soft-trash / hard-delete / cleanup_empty / trash TTL cookie scrub** as Trust exit paths via `releaseTrustBeforeThreadGone` / `clearTrustCookieWithoutRestore`.

**Ask:** One-line ADR-020 (or ADR-014 revision note) that delete/trash releases Trust and **clears** cookie; soft-trash does not re-consent on restore. Prevents the next History-IA-class feature from reopening the exit matrix.

---

### F6 — Axis fit / no new runtime / confirm dialects
**Severity:** **INFO**  
All #132 changes hang correctly:

| Piece | Surface | Compose | Autonomy | Trust | Channel |
|-------|---------|---------|----------|-------|---------|
| Trust cookie clear on trash/delete | n/a | Pack carrier unchanged | delete hygiene | lifecycle completeness | community |
| mid_loop M2 re-attach | L0 request path | none | single-loop | no trust lift | community |
| packaging SoT | n/a | none | n/a | n/a | n/a |
| voice OS copy | L0 client | none | — | privacy copy only | community |
| hard-delete broadcast | L0 multi-panel sync | — | — | — | community |

No new Agent runtime, no Pack-first violation, no new confirm dialect, no god-mode / auto_approve expansion, no originWs change.

---

## ADR-020 check

- **Surface:** mid_loop / context budget remains L0 request-path only; disk history retained. No L1/L2 elevation.
- **L2-classes:** none touched.
- **Compose:** Trust still packs through user Pack only (`origin=user` + `allowTrust`); install strip / spawn `allowTrust:false` untouched in this range. Soft-trash does not invent a composition primitive — residual is composition **left hanging** after Trust release (F2).
- **Autonomy:** trash/restore/batch remain chat-plane IA; no multi-worker Trust fan-out.
- **Trust:** monotonicity improved — exit matrix now includes soft-trash cookie retirement + hard-delete no re-fire; single-holder semantics restored under trash/restore. Journal + boot reconcile not regressed `[inspected]` (no edits to mark/reconcile paths beyond release helpers).
- **Channel:** community-only; no enterprise gate change.
- **Declaration fit for #132 (implementer should record):**
  ```text
  Surface:      L0 | n/a (packaging)
  L2-classes:   (none)
  Compose:      pack (Trust cookie lifecycle only)
  Autonomy:     n/a
  Trust:        pack trust release on trash/delete; cookie clear; no re-restore when trashed_at
  Channel:      community
  ```
- **Anti-patterns:** none (no mid-layer Agent, no new Side Panel Pack-replaceable chrome, no confirm family invent).

---

## Prior HOLDs (#126 Trust lifecycle)

| HOLD | Status at d34bac2 | Notes |
|------|-------------------|--------|
| #126 unapply restore | **HOLD** | `unapplyPack` still reads cookie then restoreSnapshot/null + restoreTrustSnapshot `[inspected]` — not edited in #132 |
| #126 uninstall restore | **HOLD** | cookie read before null; restoreTrustFromThreadCookie — untouched |
| #126 switch-away restore | **HOLD** | pre-apply restore then B apply — untouched |
| #126 install strip origin/trust | **HOLD** | `sanitizeManifestForInstall` unchanged |
| #126 spawn allowTrust:false | **HOLD** | `server.ts` spawn still `allowTrust: false` `[inspected]` |
| #126 journal + single-holder (active) | **HOLD** | journal mark/reconcile untouched; single-holder still `list()`; **strengthened** by cookie clear so trash no longer creates hidden dual cookies |
| Soft-trash cookie dual-restore / clobber (S51 P0) | **CLOSED** | F1 — release clears cookie; alreadyTrashed no re-restore; tests matrix |
| mid_loop M2 request strip (S51 P0) | **CLOSED** | F3 — re-attach + mode m2 |
| Soft-trash leaves pack composition (S51 P2-pack-split) | **HOLD residual** | F2 LOW — honesty only |
| #128 shell abort / #130 data: / #127 trash list_scope / #129 voice gates | **UNVERIFIED** in this lane | Outside #132 diff; no intentional regression surface in patch |

---

## Summary

S52 delivers the two architectural closes S51 multi-lane required:

1. **Trust × Trash lifecycle:** cookie is cleared on first release; hard-delete-from-trash never re-fires restore; multi-thread clobber class covered by tests. Core Trust B model (allowTrust gate, install strip, spawn composition-only, journal, single-holder) remains intact.
2. **Context budget dual-truth honesty:** UI rolling summary and LLM request agree after mid_loop recompact; intentional request-vs-disk dual-truth stays product-honest.

Packaging SoT consolidation is sound architecture with only fallback/CLI hardcode nits.

**Not REQUEST_CHANGES:** no incomplete Trust exit that can silently re-elevate cruise; no dishonest mid_loop dual-truth; no ADR-020 axis violation.  
**Not pure PASS:** residual composition-after-trash honesty (F2), ADR lifecycle doc lag (F5), packaging fallback/CLI version hardcodes (F4).

**Architectural status CLEAR** — lifecycle properties of Trust B under History IA soft-trash are coherent at tip; remaining items are honesty/docs/packaging nits, not dual-write holes.

**VERDICT-equivalent:** PASS_WITH_NITS
