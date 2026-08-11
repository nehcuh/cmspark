# Adversarial Fanout Diagnosis — post Precision Instrument + Graph merge

| Field | Value |
|-------|--------|
| Date | 2026-08-11 |
| Main tip | `a6eb5a3` (merge #171) |
| Scope | After #168 P1 shell · #169 Thread Graph · #170 P2a tokens · #171 P2b+3 |
| Method | **4 independent explore agents** (UI / Security / Correctness / Tests-Ops) in parallel; plus background `deep-diagnosis-fanout` workflow for full-repo subsystems |
| Mode | Read-only adversarial; no code changes in this pass |

---

## Executive summary

Precision Instrument redesign landed cleanly on presentation rails (shell, tokens, shared menus, banners). **Security perimeter was not regressed by UI merges** (Security grade **B+**, no verified P0 open). The highest ship-risk findings are **correctness / isolation races in the extension** (thread.messages unstamped, busy sticky on disconnect, graph snapshot stale re-open) and **missing regression tests** for Phase 2b/3 chrome.

| Dimension | Grade | Headline |
|-----------|-------|----------|
| Extension UI (post-merge) | **C+** | Graph re-open stale snapshot; same-thread open wipes chat; textMuted contrast |
| Security residual | **B+** | No new P0; residual eTLD wildcards / DNS-less SSRF / cruise blast radius |
| Correctness races | **C+** | thread.messages no gate; sticky busy; disconnect retry weak |
| Tests / ops | **B−** | Phase 2b/3 zero unit tests; graph prepare untested; CI ubuntu-only |
| **Overall (this fanout)** | **C+** | UI ship OK; fix High races + pin chrome contracts before more surface work |

---

## Top action plan (merged priorities)

### P0 / High — fix soon (product-visible races)

| ID | Source | Title | Rationale |
|----|--------|-------|-----------|
| **H-UI-1** / **C-RACE-05** | UI + Correctness | Graph re-open with same focus serves **stale snapshot** | `ThreadGraphApp` reads session once on mount; same URL `tabs.update` does not remount |
| **H-UI-2** | UI | Graph open current thread always `SET_ACTIVE_THREAD` → **wipes messages** | No no-op when `thread_id === active` |
| **C-RACE-01** | Correctness | `thread.messages` ignores `thread_id` | Stale transcript swap on rapid select |
| **C-RACE-02** | Correctness | Disconnect leaves sticky `threadBusyById` | Composer stuck after companion death |

### P1 — next batch

| ID | Title |
|----|--------|
| C-RACE-03 | Final assistant content only in client stream buffer; off-active done drops UI commit |
| C-RACE-04 | Optimistic Stop vs late tokens re-arm busy |
| C-RACE-07 | DisconnectedBanner “重新连接” does not force reconnect |
| C-RACE-08 | Missing `thread_id` falls back to active for busy/tools |
| C-RACE-09 | `create_tab` auto-hold via process-wide `anyTabLeaseHeld()` |
| H-UI-3 / a11y | `tokens.textMuted` ~2.4:1 contrast on light chrome |
| M-UI-1 | Graph focus_id can fall outside 300-cap set |
| T-1 | Phase 2b/3 `PanelBanner` / `SectionHeader` / `popupMenuStyles` **zero tests** |
| T-2 | `prepareThreadGraphSnapshot` filter/sort/cap untested |
| T-3 | Phase 3 motion tokens not asserted in `tokens-helpers` |
| SEC-P1-1 | Multi-tenant eTLD wildcards still accepted (`validateWildcardPattern`) |
| SEC-P1-2 | Outbound SSRF string-only (no DNS resolve) vs settings-web |
| SEC-P1-3 | Enterprise shell + auto_approve_enterprise → host RCE under injection |
| SEC-P1-4 | MCP/shell inherit full `process.env` |

### P2 — backlog

- CI PR matrix ubuntu-only (platform suites skip)
- Root package TS 6 / js-yaml drift vs product
- Wall-clock sleeps in voice/shell tests
- SEA Windows path not CI-gated (package.sh remains SoT)
- Residual hex on ModeBadge / SafetyStrip / MinimalConfirm / riskColorDark
- `tokens.transition` (180ms) largely unused
- Companion abort CAS is solid (positive control) — keep as pattern for UI busy

---

## Dimension digests

### 1. Extension UI (agent explore · grade C+)

**Solid:** prepare-before-open ordering; TG-3 keep graph open; R5 slim snapshot; popup density lock-step; FocusBand 急停 priority; DisconnectedBanner without `alert()`.

**High:**
1. Stale graph snapshot on same-focus re-open (`ThreadGraphApp` + `openOrFocusThreadGraph`).
2. Same-thread open from graph wipes chat (`SET_ACTIVE_THREAD` always clears messages).
3. `textMuted` contrast failure on light surfaces.

### 2. Security (agent explore · grade B+)

**No verified open P0** for unauth loopback control, maxPayload, config redaction, evaluate forceConfirm (sans three-flag cruise), token strip, host_write biometric.

**Residual P1** pre-exist companion security (eTLD wildcards, DNS-less SSRF, env inheritance, enterprise/cruise blast radius). **UI/graph introduced no material security coupling.**

### 3. Correctness (agent explore · grade C+)

Companion generation CAS / LLM gate release on abort is in good shape. Extension isolation and busy lifecycle are the main residual risk surface (table above).

### 4. Tests / Ops (agent explore · grade B−)

Companion security suite + CI packaging gates strong. Extension new chrome and graph prepare under-tested relative to dual-review pins. CI ubuntu-only leaves win/darwin paths unexercised on PR.

---

## Suggested next PR slices

1. **`fix/thread-isolation-and-busy`** — C-RACE-01, 02, 04, 08 (stream/busy/select gates)  
2. **`fix/thread-graph-freshness`** — H-UI-1, M-UI-1, open_thread no-op same id, snapshot tests  
3. **`test/phase-2b3-chrome-contracts`** — style pins + motion tokens + prepare snapshot unit tests  
4. **`fix/disconnect-force-reconnect`** — C-RACE-07  
5. Security residuals (eTLD / SSRF DNS) as separate security batch — not blocked on UI

---

## Evidence

| Agent | Focus | Grade |
|-------|-------|-------|
| `019ff163-5aab-…0f37fc0362b9` | Extension UI post-merge | C+ |
| `019ff163-5aab-…0f4e30a6a05f` | Security residual | B+ |
| `019ff163-5aab-…0f5274d9956f` | Correctness races | C+ |
| `019ff163-5aab-…0f63a4f92d2f` | Tests / packaging / CI | B− |

Full-repo workflow: `deep-diagnosis-fanout` (session run) may still append subsystem grades when complete — this report is the **independent 4-way adversarial synthesis** and is actionable without waiting.

---

## Merge status (this session)

| PR | Content | State |
|----|---------|--------|
| #168 | Precision Instrument Phase 1 | MERGED |
| #169 | Thread Graph v1 | MERGED |
| #170 | Phase 2a token purge | MERGED |
| #171 | Phase 2b + Phase 3 | **MERGED** `a6eb5a3` |


---

## Full-repo deep-diagnosis-fanout (completed)

Workflow finished (~16m): 10 subsystem + 6 cross-cut agents + synthesis.

| Artifact | Path |
|----------|------|
| Full report | [`deep-diagnosis-fanout-report-2026-08-11.md`](./deep-diagnosis-fanout-report-2026-08-11.md) |
| Machine summary | [`deep-diagnosis-fanout-summary-2026-08-11.json`](./deep-diagnosis-fanout-summary-2026-08-11.json) |

**Full-repo overall grade: C** · Critical 7 · High 18 · Medium 38

Overlap with this 4-agent pass: CORR-03 = thread.messages gate; SEC-02 = MCP env; sticky busy / disconnect abort appear as CORR-02 + UI busy.
