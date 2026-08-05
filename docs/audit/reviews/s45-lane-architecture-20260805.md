# Lane: Architecture — S45 main pull multi-adversarial

| Field | Value |
|-------|--------|
| **Range** | `4a2d02f..474df7e` (main pull) |
| **Repo** | `C:\Users\HuChen\Projects\cmspark` |
| **Diff artifact** | [`docs/audit/reviews/s45-main-pull-diff-20260805.patch`](./s45-main-pull-diff-20260805.patch) |
| **Lane** | Architecture (module boundaries, dual topology busy SoT, RunBusy pure layer, Trust algebra, ADR-020, packaging honesty) |
| **Evidence** | `[inspected]` patch + live tip sources (no runtime bake-off in this lane) |
| **Themes** | #122 M3' floors + run-scoped RunBusy · #123 process-path · #124 active-thread RunBusy · S44 upload busy ownership · 0.4.0 Qwen packaging |
| **Date** | 2026-08-05 |
| **Prior** | [run-state-review-bugs-lane-architecture-20260805.md](./run-state-review-bugs-lane-architecture-20260805.md) (subset: M3' + early RunBusy) |

---

## Verdict

**APPROVE_WITH_NITS**

This pull is architecture-shaped correctly for its goals:

1. **Trust floors (#122)** restore M3' monotonicity in the server gate (`domain / god-mode alone ≠ page-content trust`); computer re-L2 keeps content-sensitive tags interactive even under three-flag cruise.
2. **process-path (#123)** is a shallow infra utility with explicit consumers — not path-sandbox / apps policy leakage.
3. **RunBusy pure layer (#124)** centralizes fleet attribution in `thread-busy.ts` (`resolveFleetScope` / `buildScopedRunBusyInput`); UI consumers stop inventing process-wide fallbacks for normal threads.
4. **S44 upload** closes a dual-topology busy hole (optimistic set without companion error path) with diagnostic breadcrumbs and status events — still dual-write by design, but with completable clear paths.
5. **0.4.0 packaging** scripts/CI/release notes move the experimental locate hard-gate from TinyClick/ORT → `qwen-vl-worker.py` with on-demand weights — release *pipeline* honesty is good; residual **docs/module table** still lag.

Residual debt is **control-plane incompleteness** (scoped list vs process-wide stop), **call-site shotgun** for active-thread projection / worst-status, **Trust three-flag predicate scatter**, and **architecture.md packaging lag**. None invert the restored Trust floors or reintroduce a mid-layer agent.

**Not BLOCK.** Fast-follow recommended for F1 (stop scope) before marketing multi-run residual cleanup UX as “honest.”

---

## Capability axes (ADR-020) — this range

| Piece | Surface | Composition | Autonomy | Trust | Channel | Fit |
|-------|---------|-------------|----------|-------|---------|-----|
| M3' forceConfirm restore | L1 `evaluate` / `osascript_eval` critical APIs | — | three-flag cruise only elevates | domain≠content restored | community | **OK — Trust monotonic** |
| CU re-L2 danger/experimental under cruise | L2 `host_computer` | — | cruise silences routine re-L2 only | FORCE_INTERACTIVE carve-out | community | **OK** |
| `open_intents_by_run` + client scope | — | not Pack/MCP | Autonomy UI signal (ADR-015/016) | — | community | **OK — not mid-agent** |
| `process-path` | spawn/env infra | — | — | avoids ENOTDIR under corrupted PATH | community | **OK shallow utility** |
| `chat.reasoning` / reasoning_content | stream UX | — | — | no new tool surface | community | **OK presentation** |
| file.upload_status / upload_error clear | L0 chat attachment | — | busy ownership | no new trust gate | community | **OK dual-topology repair** |
| Qwen worker package gate | L2 experimental locate | — | — | weights out-of-band | community | **OK honesty if docs match** |

**Axis language check:** No new Agent type, Board fork, Composition export, or bare mid-layer runtime. RunBusy remains **presentation of Autonomy state**, not a Surface level. `process-path` is process/env hygiene, not Host path-sandbox policy.

---

## Findings

### F1 — Scoped fleet **display** vs process-wide **stop** (control-plane incomplete)
**Severity:** HIGH (Autonomy control plane / dual-topology honesty)  
**Where:**

- UI list scoped: `FleetWorkerList.tsx:41-60`, `FleetStrip.tsx:39-90` via `resolveFleetScope` / `workersInFleetScope`
- Stop still unscoped message: `FleetWorkerList.tsx:70-78`, `FleetStrip.tsx:99-108` → `chrome.runtime.sendMessage({ type: "fleet.stop_all" })` **without** `orchestrator_run_id`
- Companion already supports run filter: `message-router.ts:1809-1820` — if `rest.orchestrator_run_id` set → `listWorkers(tm, runId)`, else **all** `agent_role === "worker"`
- `scope.kind === "none"`: list empty + button `disabled` when scoped workers length 0 (`FleetWorkerList.tsx:207-211`), yet `title` claims process-wide residual cleanup is available — **affordance contradiction**

**Architecture issue:** #124 fixed **false positive RunBusy** from foreign residual workers by scoping **signals**. Destructive control stays process-wide. Under multi-run residual (the exact pen-test worker scenario in `thread-busy.test.ts`), a user viewing run A’s list and confirming 「停止全部子任务」kills run B’s workers. Companion already has the run-scoped hook; UI never threads it.

**Ask:**

1. Pass `orchestrator_run_id` when `scope.kind === "run"`.
2. For `parent` scope without run stamp: either scope by parent host or keep process-wide with explicit confirm copy.
3. For `none`: either enable a labeled “清理进程内残留 worker” path or drop the title claim that implies the disabled button can clean residuals.

---

### F2 — Busy dual-write remains structural (Extension optimistic + Companion llm_active)
**Severity:** MEDIUM (dual topology SoT; mitigated by S44, not eliminated)  
**Where:**

| Layer | Signal | Owner |
|-------|--------|--------|
| Side Panel store | `isProcessing` (active panel) | optimistic send + WS clears |
| Side Panel store | `threadBusyById` | optimistic + `chat.*` / `file.*` / tools |
| Companion | `abortControllers` → `fleet.llm_active_thread_ids` | server truth for LLM in flight |
| Companion | worker `status` / locks / intents | fleet snapshot |

- Optimistic set: `App.tsx:555-557` (upload), similar chat path ~629-631
- Clear paths added: `file.upload_error` / `file.uploaded` / SW send failure (`useWebSocket.ts:1176-1217`, `App.tsx:481-497`); `error` also clears map (`useWebSocket.ts:1250-1257`)
- Pure predicates: `deriveThreadBusy` / `deriveRunBusy` correctly **consume** dual signals (`thread-busy.ts:8-15`, `29+`)

**Architecture issue:** There is still no single write path. Companion does not own `threadBusyById`; Extension does not treat `llm_active_thread_ids` as the only busy bit. S44 fixed the stuck-upload class (set without clear). Residual: any future optimistic set without a paired terminal event re-opens stuck UI; `isProcessing` is still active-thread-global and can desync from `threadBusyById` when switching threads mid-flight (SoT already documents map retention + clear local stream — intentional).

**Ask:** Keep dual-write but document a **busy event matrix** (set/clear × message type × thread stamp). Prefer: optimistic set only when `thread_id` known; every terminal WS type clears both bits for that id. Mid-term optional: derive composer busy primarily from map + fleet llm_active, demote `isProcessing` to “active stream chrome.”

---

### F3 — Shotgun active-thread projection + worst-status (not busy *logic* duplication)
**Severity:** MEDIUM (divergent change / drift risk)  
**Where:**

Same `active: { id, agent_role, parent_thread_id, orchestrator_run_id }` object built independently at:

- `App.tsx:323-340`
- `ChatView.tsx:96-111`
- `RunBusyChip.tsx:34-48`
- `FleetStrip.tsx:39-54`
- `FocusBand.tsx:54-69`

`FleetWorkerList` correctly reuses `resolveFleetScope` + `workersInFleetScope` but **not** `buildScopedRunBusyInput` (`FleetWorkerList.tsx:41-60`).

Worst-status ternary (`holding_tabs` → `paused` → `idle` → `none`) duplicated:

- `ChatView.tsx:120-126`
- `FleetStrip.tsx:75-81`
- `FocusBand.tsx:71-77`

**Architecture issue:** Busy **predicates** are no longer shotgun (`buildScopedRunBusyInput` closed prior F2 from review-bugs lane). Input **projection** and worst-status still are. Any new thread field for scope will require 5-site edit; any status priority change risks FocusBand ≠ FleetStrip.

**Ask:** One hook or selector, e.g. `useActiveFleetScope()` → `{ scope, runBusyInput, scopedWorkers, workerCount, worstStatus }`. Export `worstStatusFromWorkers(workers)` next to pure helpers. Prefer not re-deriving in JSX.

---

### F4 — Trust algebra centralized in spirit, scattered in implementation
**Severity:** MEDIUM (Trust packaging / lock-step risk)  
**Where:**

Three-flag cruise predicate reimplemented:

- Cookie early gate: `server.ts:861-864`, waive at `891-898`
- L2 forceConfirm: `server.ts:1467-1478` (`forceConfirm = criticalApis.length > 0 && !userFullAutonomy`)
- CU re-L2: `executor.ts:647-663` (inline same three flags + `FORCE_INTERACTIVE_DANGEROUS` first)

Prior inversion **closed:** removed `browserScriptTool && skipConfirmation` waive path (patch `server.ts` forceConfirm). Tests realigned in `security-gates.test.ts` (god-mode alone / domain whitelist still forceConfirm; cruise waives).

**Architecture issue:** Algebra is **consistent today** but not a shared pure function. Future flag rename or fourth flag will miss a site. Executor comments still say “TinyClick G4” while product locate is Qwen — naming drift, not gate wrongness.

**Ask:** Extract `isUserFullAutonomyCruise(sec)` (+ optional `shouldForceInteractiveDangerous(tags)`) under `security/` or `capability/`; unit-test once; import from server + executor. Update comments TinyClick → experimental locate / content-sensitive re-L2.

---

### F5 — `parent` scope open intents always 0 (honest but incomplete Autonomy signal)
**Severity:** LOW–MEDIUM (Autonomy UI completeness)  
**Where:**

- `resolveOpenIntentsForScope`: `thread-busy.ts:199-209` — `parent` returns 0 (void process-wide count)
- Companion attributes intents only when host has `orchestrator_run_id`: `fleet.ts:open_intents_by_run` aggregation

**Architecture issue:** Correct fail-closed vs sticky foreign intents. Cost: hosts without run stamp that still parent workers never light intent-only RunBusy even if their board is active. Prefer stamping run id on spawn (upstream) over reopening process-wide fallback.

**Ask:** Ensure spawn/orchestrator always stamps `orchestrator_run_id` on host+workers; treat parent-without-run as legacy. Optional: aggregate intents by parent host id server-side if stamp gap remains.

---

### F6 — process-path boundaries: deep enough, shallow enough
**Severity:** LOW (positive with residual dual entry)  
**Where:**

- Module: `companion/src/process-path.ts:1-148` — split / keep-dirs / essentials / harden / `OSASCRIPT_BIN` / `applyHardenedProcessPath`
- Consumers: `index.ts` (earliest), `server.ts:5707+` (startServer), `capability/shell.ts`, `apps/cli-exec.ts`, `mcp/transport.ts`, `platform.ts`, `menu-bar-agent.ts`, `obsidian/folder-picker.ts`, `server.ts` osascript_eval

**Architecture read:** This is **process spawn hygiene**, not Host path-sandbox / workspace root policy. Apps (`cli-exec`) only harden child `PATH` after its own env allowlist — no apps-domain path policy moved into process-path. Absolute `OSASCRIPT_BIN` is the right dual defense with process PATH rewrite (file-in-PATH still breaks bare names).

**Residual:** `applyHardenedProcessPath` called at both CLI entry and `startServer` — intentional defense-in-depth, not dual SoT. MCP `buildSpawnPath` reuses `keepOnlyDirectories` but still builds its own candidate set — fine composition.

**Ask:** None blocking. Avoid putting workspace containment or trust-domain checks into this module.

---

### F7 — Packaging architecture honesty (scripts OK; live docs lag)
**Severity:** MEDIUM (product packaging honesty)  
**Where (aligned):**

- `scripts/package.sh` — remove `stage_onnxruntime` / tinyclick stage; hard-gate `qwen-vl-worker.py`
- `scripts/build-windows-exe.ps1` — same; version `0.4.0`
- `.github/workflows/release.yml` — asserts qwen worker; release body on-demand weights
- `scripts/tests/test-package-gates.sh` — locks lacks tinyclick / stage_onnxruntime, has qwen

**Where (lag):**

- `docs/architecture.md:679` still lists **TinyClick** under `computer/`
- `docs/architecture.md:671` still says computer L2 “god-mode / auto_approve **永不跳过**” without three-flag cruise exception (code: cruise can waive initial forceConfirm for host_computer critical surface)
- `companion/models.manifest.json` still carries tinyclick provenance (optional stage only)
- esbuild still `--external:onnxruntime-node` “residual import” — honest for graph leftovers, not a ship asset

**Architecture issue:** Ship pipeline and CI gates tell one story (Qwen experimental + on-demand weights). Architecture module table and CU one-liner still tell 0.3.x TinyClick / absolute-never-skip story. Risk is operator expectation, not runtime zip contents.

**Ask:** One docs pass: architecture §9 module table → Qwen VL experimental; L2 bullet → three-flag cruise exception + danger re-L2 always HITL. Keep `docs/qwen-vl-experimental-layer.md` as SoT for locate.

---

### F8 — Upload diagnostics cross cut (panel → SW → WS → companion)
**Severity:** LOW (observability layering; acceptable temporary density)  
**Where:**

- Panel: `App.tsx` diag.file_upload phases + console
- SW: `background/index.ts` `diag.file_upload` + `file.upload` size estimates
- WS client: `getDiag()` (`ws-client.ts`)
- Companion: `ws.file_upload.received` pre-auth, `message-router` phase logs + `file.upload_status`

**Architecture issue:** Diagnostics correctly stay **meta** (no base64 content). They add a parallel message type and log volume. Not a new agent; not Trust boundary. Long-term should gate behind debug or sample at info.

**Ask:** After bake-in, drop to `debug` or config flag; keep `upload_error` / status events as product path.

---

### F9 — Deprecated dual API `filterIdsByRun` residual
**Severity:** NIT  
**Where:** `thread-busy.ts:95-105` still exports process-wide-on-null `filterIdsByRun`; tests keep it; production UI moved to `filterIdsByFleetScope` / `buildScopedRunBusyInput`.

**Ask:** Mark `@deprecated` in JSDoc (already on `resolveOpenIntentsForRun`); remove when no external importers.

---

## Positives

1. **`buildScopedRunBusyInput` as pure SoT** — closes the pre-#124 process-wide fallback that painted foreign residual workers on normal threads; unit tests encode the pen-test worker fixture (`thread-busy.test.ts`).
2. **Companion `open_intents_by_run`** additive fleet field is correct placement (Autonomy signal, not Composition primitive).
3. **M3' restore is monotonic Trust** — removes browser-script domain/god-mode waiver; cruise remains explicit residual-risk package; integration tests inverted from auto-approve to forceConfirm.
4. **process-path extraction** is textbook shallow utility: pure functions, injectable FS probe, absolute macOS bin, dual apply sites without policy creep into apps guards.
5. **S44 busy completion** pairs optimistic UI with `file.upload_error`, SW `!ok` clear, and try/catch around parse/vision so companion throws don’t leave panel stuck on only generic `error`.
6. **Packaging model shift** is fail-closed on the *new* critical sidecar (qwen worker) and explicitly **not** fail-closed on multi-hundred-MB weights/ORT — correct product architecture for experimental locate.
7. **No ADR-020 middle agent** — reasoning stream, diagnostics, and scope pure layer stay presentation/infra.

---

## Layering diagram (brief)

```
┌─ Side Panel (React) ──────────────────────────────────────────┐
│  pure: thread-busy (FleetScope → RunBusyInput)                  │
│  store: isProcessing ∥ threadBusyById  ← optimistic + WS        │
│  UI: App / ChatView / RunBusyChip / FocusBand / Fleet*          │
└──────────────────────────┬─────────────────────────────────────┘
                           │ chrome.runtime (file.upload, fleet.*)
┌─ Extension SW ───────────┴─────────────────────────────────────┐
│  WS client + getDiag; file.upload size guard logs               │
└──────────────────────────┬─────────────────────────────────────┘
                           │ WebSocket
┌─ Companion ──────────────┴─────────────────────────────────────┐
│  server gate: Trust algebra (forceConfirm / cruise)             │
│  message-router: file.upload_status|error|uploaded + chat       │
│  fleet snapshot: workers, locks, open_intents_by_run, llm_active│
│  process-path: harden PATH + OSASCRIPT_BIN (spawn hygiene)      │
│  executor re-L2: cruise ∩ ¬FORCE_INTERACTIVE                    │
└────────────────────────────────────────────────────────────────┘
```

**SoT notes:** LLM-in-flight truth ≈ companion abort map; **UI busy chrome** ≈ Extension map + optimistic; **fleet attribution** ≈ pure client scope over process-wide snapshot.

---

## Recommendation summary

| Priority | Item |
|----------|------|
| **P0 fast-follow** | F1: wire `fleet.stop_all` with `orchestrator_run_id` when scope is run; fix none-scope stop affordance |
| **P1** | F3: `useActiveFleetScope` / `worstStatusFromWorkers` to kill 5-site shotgun |
| **P1** | F4: shared `isUserFullAutonomyCruise` (+ interactive danger tags) |
| **P1** | F7: architecture.md TinyClick / “永不跳过” honesty vs 0.4.0 + cruise |
| **P2** | F2 busy event matrix; F5 stamp run ids; F8 gate diag logs |

### Verdict line

**VERDICT: APPROVE_WITH_NITS**

Ship quality for Trust floors, process-path module boundary, RunBusy pure scoping, upload busy completion, and packaging *pipeline* is sound. Do not treat multi-run residual UX as complete until stop control matches scoped display (F1).

---

*Lane: Architecture · S45 main pull · 2026-08-05 · evidence `[inspected]`*
