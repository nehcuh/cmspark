# Lane: Architecture — S51 post-ship multi-adversarial (6d2cdcf..HEAD)

| Field | Value |
|-------|--------|
| **Range** | `6d2cdcf..HEAD` |
| **Repo** | `C:\Users\HuChen\Projects\cmspark` |
| **Lane** | Architecture (ADR-020 Surface / Composition / Autonomy / Trust; Pack-first; no new runtime; confirm dialects) |
| **Evidence** | `[inspected]` live tip sources: `pack-engine.ts`, `message-router.ts`, `server.ts`, `adapter.ts`, `context-budget*.ts`, `shell.ts`, voice hooks, ThreadList/context-refs, Settings accordion helpers, ADR-020, architecture.md, product specs. No runtime bake-off in this lane. |
| **Themes** | Trust B lifecycle (#126), Thread History IA, shell abort, voice input, analyze_image `data:`, settings accordion + context budget + collapsible timeline |
| **Date** | 2026-08-07 |
| **Prior** | [s46-lane-architecture-20260806.md](./s46-lane-architecture-20260806.md) · [multi-adversarial-review-20260806-main-s46.md](./multi-adversarial-review-20260806-main-s46.md) · #126 Trust B lifecycle |

---

## Verdict

**REQUEST_CHANGES**

Post-#126 Trust B **core** architecture is sound: `allowTrust` default-false + UI-only true, spawn composition-only, install strip of `origin:user`+`trust`, single-holder conflict, applying→held journal + boot reconcile, restore on unapply / switch-away / uninstall / hard-delete, ADR-020 exception + architecture.md 叠加纪律 aligned. That closes S46 Architecture F1/F2/F6 class defects.

**Thread History IA soft-trash reopens a Trust dual-write lifecycle hole.** `releaseTrustBeforeThreadGone` restores globals and clears the journal but **does not clear** `mission_pack_trust_snapshot` on the thread. Soft-delete (`mode:"trash"`, History IA default) keeps the cookie on a still-indexed thread. After restore-from-trash, dual cookies can coexist; unapply / re-delete of the stale holder can **clobber the live holder’s cruise** via `restoreTrustSnapshot(stale_pre_snap)`. Single-holder is only enforced at `applyPack`, not at trash/restore. Sticky cruise is fixed; **cookie ownership is not.**

All other S51 themes are axis-clean or product nits:

| Theme | Axis fit | Architecture status |
|-------|----------|---------------------|
| Trust B #126 paths | Trust packaging on user Pack | **OK core** · **broken soft-trash cookie** (F1) |
| Thread History IA | L0 product UX + Autonomy hygiene (delete) | **OK** except Trust×trash seam |
| `@` summary_card | L0 data injection, not Composition primitive | **OK** (budgeted, fenced, no full dump) |
| Context budget M1/M2 | L0 request-path; disk history retained | **OK as product feature** · nits on default/ack |
| Settings accordion + timeline fold | L0 IA only | **OK** (armed force-open) |
| shell abort | L2 shell control plane refinement | **OK** (no new confirm dialect) |
| Voice input | L0 client composer I/O | **OK** (not Surface elevation) |
| analyze_image `data:` | L1 tool correctness | **OK** (decode in-bridge, not new Surface) |

**Not REJECT** — no new Agent runtime, no Pack-first violation on non-Trust themes, no mid-layer confirm dialect invent.  
**Not PASS_WITH_NITS** — Trust cookie after soft-trash is a lifecycle property defect of the same class S46 blocked on (exit matrix incomplete).

**Minimum to re-verdict toward PASS_WITH_NITS / PASS:**

1. On soft-trash (and any `releaseTrustBeforeThreadGone` path that leaves the thread alive): **clear `mission_pack_trust_snapshot`** (and preferably unapply composition or document “pack still applied, Trust released”). Persist via `applyPackPatch` so restore-from-trash does not resurrect a Trust cookie without re-consent.  
2. Tests: apply Trust A → trash A → apply Trust B → restore A → unapply A must **not** drop B’s globals; single-holder after restore must refuse or re-consent.  
3. Optional residual: first-run informed ack for default `context_compaction: auto` (product honesty).

---

## Capability axes (ADR-020) — this range

| Piece | Surface | Composition | Autonomy | Trust | Fit |
|-------|---------|-------------|----------|-------|-----|
| Trust B lifecycle #126 | n/a | carrier = user Pack | — | global three-flag + modules; restore + journal + allowTrust | **OK packaging** except F1 |
| Soft trash / batch trash | L0 IA | — | delete hygiene | releaseTrust without cookie clear | **Lifecycle hole** |
| `@` context_refs summary_card | L0 chat data | not Skill/MCP/Pack | single-loop only | no trust lift | **OK product feature** |
| Runtime context budget | L0 request path | orthogonal to Digest/Export | worker independent (per-thread messages) | no trust lift | **OK explicit product** |
| Settings accordion | L0 | none | — | force-open security when armed | **OK control-plane honesty** |
| Collapsible today/yesterday | L0 list IA | — | — | — | **OK** |
| shell.exec.abort / chat.abort→shell tree | L2 shell | existing module | stop granularity | reuses L2 shell gate | **OK** |
| Voice Web Speech | L0 composer | none | never auto-send | privacy ack local | **OK client-only** |
| analyze_image `data:` promote | L1 CDP tool | none | — | existing vision path | **OK fix, not elevation** |

**Anti-pattern scan:** No new Side Panel first-class permanent entry for a Pack-replaceable scenario. No new confirm family for voice/budget/history. No “mid-layer Agent” runtime. Pack-first holds.

---

## Focus answers (task checklist)

### 1. ADR-020 axes: Surface / Compose / Autonomy / Trust monotonicity; Pack-first; no new runtime; confirm dialects

**Hold for non-Trust themes.** Trust B remains the only intentional Pack→global Trust write, now documented in ADR-020 Composition rule 2 exception + `architecture.md` §叠加纪律 / §7.5 `[inspected]`. Spawn does not invent a second Trust consent dialect — it sets `allowTrust: false` and audits `pack.trust_skipped` `[inspected]` `server.ts:3281–3292`. Shell abort reuses existing shell capability surface. Voice / budget / history are chat-plane product features, not Composition primitives (consistent with ADR-020 “export/render not composition”).

### 2. Trust B after #126 — still sound?

**Core yes; soft-trash seam no.**

| Gate | Status | Evidence |
|------|--------|----------|
| `allowTrust` default false | **OK** | `pack-engine.ts:1225`; spawn `allowTrust: false` `server.ts:3290–3292` |
| UI apply / save+apply `allowTrust: true` | **OK** | `message-router.ts:2412–2415`, `:2523` |
| Install strip `origin:user`+`trust` | **OK** | `sanitizeManifestForInstall` + `installPackFromDirectory` `pack-engine.ts:417–429`, `:1019–1023` |
| Switch-away restore | **OK** | `applyPack` pre-restore `pack-engine.ts:1229–1239` |
| Unapply / uninstall restore | **OK** | `unapplyPack` / `uninstallPack` read cookie before null `pack-engine.ts:1457–1481`, `:1507–1527` |
| Single-holder | **OK at apply** | `findOtherTrustHolders` + `trust_holder_conflict` `pack-engine.ts:300–312`, `:1249–1261` — **uses `list()` → excludes trashed** |
| Journal + boot reconcile | **OK** | `markTrustApplying` / `markTrustHeld` / `reconcilePackTrustOnBoot` `pack-engine.ts:254–357`; boot `server.ts:559–564` |
| Hard delete / cleanup_empty | **OK** | `releaseTrustBeforeThreadGone` then unlink `message-router.ts:1192–1193`, `:1346–1349` |
| Soft trash keeps cookie | **BROKEN** | release restores + journal clear; **no cookie clear** `pack-engine.ts:391–409` + trash `message-router.ts:1198–1204` |

Product claim “退出/切换/删除场景会尽量恢复” is honest for pack exits; soft-delete of a **conversation** is a different exit that still mutates Trust without fully retiring the cookie as ownership token.

### 3. Context budget — silent destructive composition or explicit product feature with recovery?

**Explicit product feature with recovery semantics (request-path only).** Not silent destructive composition.

- Spec + axes: Surface L0; Compose none; disk messages retained; UI dual-truth banner `[inspected]` `docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md`, `ChatView.tsx:364–375`.
- Algorithm: turn-safe head-drop + omit/summary notice; tool pairs preserved; redaction for M2 `context-budget.ts` `[inspected]`.
- Modes: `auto` | `prompt` | `off` persisted on companion config; WS events `thread.context_compacted` / `thread.context_compact_prompt` `[inspected]` `adapter.ts:484–624`, `useWebSocket.ts:713–748`.
- Recovery: full UI history; settings deep-link in prompt mode; optional rolling_summary in thread meta (not Digest/Export).
- **Not** a Pack/Skill composition rewrite of history.

**Nits (not holes):** default `auto` + `context_compaction_m2: true` on new installs (`config.ts:282–284`) means first compaction can occur without the Settings `window.confirm` path (confirm only fires when *switching to* auto in UI — `SettingsSlideout.tsx:985–989`). Spec D-C7 “enable auto once informed ack” is only partially implemented. Mid-loop M1 recompact shipped as intentional follow-up (`adapter.ts:1176–1177`) despite early “pre_loop only” wording — still request-only; acceptable.

### 4. Voice — client-only composition or wrong surface elevation?

**Client-only L0 composer I/O. Correct surface.**

- Web Speech in extension Side Panel; draft merge only (`onDraft` → `setText`); **never auto-send**; send blocked while listening (`App.tsx:370–409`).
- Privacy ack + mic bootstrap tabs; no Companion tool, no L2, no new WS capability surface for recognition audio.
- Not Composition (not Skill/MCP/Pack). Abort couples to Stop → chat.abort order (`App.tsx:791–796`) — control-plane hygiene, not Surface elevation.

### 5. Thread history IA — autonomy / composition boundaries OK?

**Mostly OK.**

- Timeline / tags / soft trash / batch delete / digests = product UX + index metadata — **not** Composition primitives (spec ADR-020 coordinate: chat-plane UX).
- `@` refs: user-gesture injection of **summary_card** data fence; server forbids `mode:"full"`; budget 1500 tokens; “资料非指令” framing `[inspected]` `context-refs.ts:29–91`, `message-router.ts:627–663`. No autonomous cross-thread fan-out.
- AI digest fill is background metadata (on_at_ref), not auto-delete / auto-spawn.
- **Boundary break only where History IA delete path intersects Trust B** (F1).

### 6. User perspective — product design debt vs real architecture hole?

| Item | Class |
|------|--------|
| Soft-trash leaves Trust cookie → dual holder / clobber on restore | **Architecture hole** (Trust dual-write lifecycle) |
| Default auto compaction without first-run ack | **Product design debt** (honesty / informed consent) |
| M2 default on vs early “default off” in one spec table | **Spec drift / debt** (code + Settings copy now say default on) |
| Settings accordion / collapsible timeline | **Product UX** (sound) |
| Shell stop without killing whole chat | **Product win** on L2 control plane |
| Voice mic privacy / Chrome tier | **Product / platform** (not architecture) |
| analyze_image `data:` false Security Block | **Correctness fix** on L1 tool (architecture OK) |

---

## Findings

### F1 — Soft-trash releases Trust globals but keeps Trust cookie (dual-holder / clobber on restore)
**Severity:** **HIGH**  
**Where:**

- `releaseTrustBeforeThreadGone` — restore + journal clear, **no** cookie nulling: `companion/src/packs/pack-engine.ts:391–409`
- Soft-delete path calls release then `threadManager.trash` (thread remains in index with fields intact): `companion/src/message-router.ts:1190–1204`
- Batch trash same release: `message-router.ts:1253–1263`
- `findOtherTrustHolders` uses `list()` excluding trashed: `pack-engine.ts:300–312` + `thread-manager.ts:441–445`
- `thread.restore` only clears `trashed_at` — **no** Trust re-consent / cookie scrub: `message-router.ts:1287–1307`, `thread-manager.ts:388–396`
- Comment on restore helper admits cookie is not cleared by restore helper: `pack-engine.ts:233–236`

**Architecture issue:** Trust B single-holder + journal model assumes **cookie presence ≡ active Trust ownership**. Soft-trash violates that invariant:

1. Apply Trust on thread A → globals elevated, cookie A, journal held A.  
2. Soft-trash A (History IA default delete) → globals restored, journal cleared, **cookie A remains** (A hidden from `list()`).  
3. Apply Trust on B → single-holder OK → cruise elevated for B.  
4. Restore A from trash → **cookies A and B both active**; journal only tracks B.  
5. Unapply A or hard-delete A → `restoreTrustSnapshot(A.pre_snap)` **overwrites B’s elevated globals** with A’s pre-Trust baseline; journal for B may remain held while cruise is wrong.

Hard-delete after trash (purge) drops the file so cookie dies — OK. Soft-trash + restore is the delivered History IA path — **not** theoretical.

**Ask (must fix):**

1. After successful restore-from-cookie in `releaseTrustBeforeThreadGone`, **persist** `mission_pack_trust_snapshot: null` on that thread (requires ThreadManager patch API; pass manager or return “caller must clear”). Prefer also unapply pack composition on trash of Trust holder, or explicitly document “场景仍挂着，Trust 已释放” with UI.  
2. On `thread.restore`, if cookie present without matching journal/globals elevation: either clear cookie, re-run single-holder + user re-consent to re-elevate, or refuse restore until user exits scene.  
3. Tests for the matrix above; extend packs-engine / thread delete tests beyond hard-delete only (`packs-engine.test.ts:441–476` covers hard-path only).

---

### F2 — Context budget default-on without first-run informed ack
**Severity:** **MED** (product honesty / dual-truth UX — not a Surface/Trust hole)  
**Where:**

- Defaults: `companion/src/config.ts:282–284` (`context_compaction: "auto"`, `context_compaction_m2: true`)
- UI confirm only when user *selects* auto: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:985–989`
- Spec D-C7: enable auto once informed ack (`docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md:86–87`)

**Architecture issue:** Request-path drop is correctly non-destructive to disk and is dual-truth signaled after the fact (`ChatView` banner). Default-on means first long-thread users may hit compression with only post-hoc banner — weaker than “informed enable” but **recoverable** (history intact, mode switchable to `off`/`prompt`). Treat as product debt, not silent composition rewrite.

**Ask:** First-session or first-compaction modal / one-shot LS ack when default auto first fires; or ship default `prompt` until ack (product choice).

---

### F3 — Soft-trash Trust release is process-global without unapplying Pack composition
**Severity:** **MED** (control-plane / user model)  
**Where:** same as F1; composition fields (`mission_pack_id`, whitelist, skills) survive trash while Trust cruise is restored.

**Architecture issue:** User model after soft-delete: “对话进回收站” vs “场景 Trust 已关但场景配方还在 index 里”. On restore, pack appears still applied without Trust elevation — split-brain between Composition attach and Trust packaging. Related to F1; can fix together by soft-trash = `unapplyPack` (or Trust-clear + explicit UI).

**Ask:** Prefer soft-trash of Trust-holding thread → `unapplyPack` (restores Trust + composition) then trash; or trash + clear cookie + leave pack only if UI shows “场景已失效”.

---

### F4 — Multi-thread Trust still process-global by design (documented residual)
**Severity:** **LOW** (accepted residual of Trust B product decision)  
**Where:** `applyUserPackTrust` / `restoreTrustSnapshot` write `config.json` globals `pack-engine.ts:150–226`; single-holder serializes writers.

**Note:** Not new in this range. Single-holder is the correct short-term architecture. F1 breaks that serialization under soft-trash. Do not invent per-thread auto_approve without a new ADR.

---

### F5 — Voice / shell abort / analyze_image `data:` / settings accordion
**Severity:** **LOW** / non-blocking notes

| Item | Note |
|------|------|
| Voice | Client-only; no wrong Surface elevation. Residual: platform Web Speech privacy is vendor-side — product disclosure only. |
| Shell abort | `abortShellRunsForThread` on `chat.abort` + `shell.exec.abort` by id `shell.ts:43–72`, `server.ts:6450–6493`. Correct control-plane refinement; kill tree not just parent. |
| analyze_image `data:` | `promoteFetchSrc` / decode in SW after CDP — L1 tool correctness (`browser-bridge.ts:552–590`). Does not elevate to L2 or skip confirm dialects. Security residual (cookie fetch etc.) is separate lane history. |
| Settings accordion | Force-open security when armed `settings-sections.ts:56–84` — good Trust disclosure. No new confirm dialect. |
| Timeline fold | Pure list IA; SoT linked from settings-thread-compact — OK. |

---

## Themes closed vs open (vs S46 Architecture)

| S46 Arch finding | Post-#126 / S51 status |
|------------------|------------------------|
| F1 restore switch/uninstall | **CLOSED** on pack paths |
| F2 ADR-020 / architecture SoT | **CLOSED** (exception language present) |
| F3 PacksPanel honesty | **CLOSED enough** — list badge + apply modal Trust warning `PacksPanel.tsx:747–760`, `:874–881` |
| F6 spawn Trust elevation | **CLOSED** `allowTrust: false` |
| Soft-trash × Trust cookie | **OPEN — NEW (this range / IA)** |

---

## Suggested fix order

1. **P0:** F1 cookie clear on soft-trash release + restore-from-trash policy + tests.  
2. **P1:** F3 soft-trash composition honesty (unapply vs keep pack).  
3. **P2:** F2 first-run context budget ack.

---

## Evidence levels

- All claims above: **`[inspected]`** source + prior S46 multi-lane + project-knowledge Trust B notes.  
- No **`[executed]`** test run in this architecture lane session.  
- Tests exist for #126 hard paths (`packs-engine.test.ts` allowTrust / switch / journal / releaseTrustBeforeThreadGone hard-delete) — **gap:** soft-trash dual-cookie matrix not covered `[assumed]` from grep of test names.

---

## Capability declaration (this review)

```text
Surface:      review-only
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        n/a
Channel:      community
```

---

*Architecture lane · S51 · adversarial · 2026-08-07*
