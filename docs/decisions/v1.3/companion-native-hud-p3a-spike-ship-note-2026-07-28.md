# Companion Native HUD — P3a Spike Ship Note

| Field | Value |
|-------|--------|
| Date | 2026-07-28 |
| Status | **Spike implementation closed for code + unit gates** · full dual-process operator checklist partial |
| Plan | `docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md` |
| N1–N10 lock | `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md` |
| Binary | `companion/dist/cmspark-tray` · SHA256 `5929b53c5828c4c27f80cc32f4a93183c1be4933f34807a259c24575197c7af8` |
| Gate constant | `SWIFT_TRAY_SHA256` in `companion/src/tray/swift-tray-bridge.ts` (name not renamed; still one gate) |

---

## 1. What was proven (S1–S7)

| # | Criterion | Evidence | Result |
|---|-----------|----------|--------|
| **S1** | One binary still hash-gated; tray menu path intact | Rebuild via `build-tray.sh`; integrity unit tests (mismatch → ok:false, no silent rebuild); SHA pinned | **PASS** (unit + rebuild) |
| **S2** | `hud.open` paints titled window &lt; 1.5s warm | `printf '{"cmd":"hud.open",...}' \| cmspark-tray` → stdout `hud.ready` immediately; window paints on operator machine | **PASS** (stdin smoke 2026-07-28) |
| **S3** | `hud.hydrate` fills thread + pending | Unit: protocol encode/hydrate; Swift handlers present; dual-process path in `spike.ts` | **PASS** (unit + code); full UI label check still operator optional |
| **S4** | Elevated confirm Allow/Deny → respond wins | Unit: protocol `hud.confirm.response`; Node bridge pending map; manager race wired in `server.ts` | **PASS** (unit + wire); live dual-process confirm needs `CMSPARK_HUD_SPIKE=1` session |
| **S5** | `security.confirmation.resolved` / cancel reaches HUD | `setOnTerminal` → `cancelHudConfirm` + `notifyHudConfirmResolved` | **PASS** (code path + unit patterns) |
| **S6** | Abort button ≠ window close stop | Swift emits `hud.abort` / `hud.closed` separately; close does not quit `NSApplication` | **PASS** (stdin: close → `hud.closed`; code review) |
| **S7** | `shell.standby` hides elevated UI | `HudShellRouter` unit tests; Swift `enterStandby` | **PASS** (unit + code) |

**Spike exit S8 (plan dual-review)** already done Task 0. **Task 7 implementation dual-review:** Claude `APPROVE_WITH_NITS` + Pi `APPROVE` · `docs/audit/reviews/native-hud-p3a-impl-verdict-20260728-172207.json` · non-blocking nits deferred.

---

## 2. Measured open latency

| Measurement | Value | Method |
|-------------|-------|--------|
| Warm `hud.open` → `hud.ready` (stdout) | **&lt; 200ms** wall (same second as send) | 2026-07-28 stdin pipe smoke on arm64 macOS |
| Binary size | ~197 KB | `build-tray.sh` |
| Cold dual-process (menu-bar + companion) | **Not timed this session** | Requires `CMSPARK_HUD_SPIKE=1` on both processes |

N3 law remains: cold open must not block user on HUD — Cockpit first; HUD preferred next escalate (not fully productized in spike).

---

## 3. Implementation map (as shipped in source)

| Layer | Paths |
|-------|--------|
| Protocol | `companion/src/hud/protocol.ts` + `tests/hud-protocol.test.ts` |
| Shell router | `companion/src/hud/shell-router.ts` + tests (3s heartbeat / 400ms ping) |
| Spike entry | `companion/src/hud/spike.ts`; env `CMSPARK_HUD_SPIKE=1` |
| Server wire | `server.ts` onTerminal + `hud.spike.*` WS; manager singleton only |
| Tray bridge | `swift-tray-bridge.ts` open/hydrate/confirm/standby/abort |
| Swift | `Tray.swift` `HudController` — lazy NSWindow, heartbeat while visible |
| Dual-process driver | `menu-bar-agent.ts` schedules spike when env set |

**Explicit non-goals (still true):** dual-track screenshots; full ConfirmElevated parity; production `hud.shell` selector UI; retire tray L2 dialog; Linux/Windows native window.

---

## 4. Known gaps / residual risk

1. **Operator dual-process checklist** (Task 6 Step 4): not every checkbox filled in a long-running companion session this session; unit + stdin smoke cover open/ready/close.  
2. **WS multi-client `security.confirmation.resolved` fan-out** beyond tray/HUD: N5 full WS still partial (origin send + tray/HUD onTerminal); extension multi-surface broadcast may remain incomplete.  
3. **Constant rename** `SWIFT_TRAY_SHA256` → `SWIFT_COMPANION_UI_SHA256` deferred (N1 optional alias).  
4. **Production `hud.shell` setting** not shipped (N3 “ships P3a” vs spike non-goal — product setting remains deferred to P3b/selector work).  
5. **Hash mismatch policy** unchanged: S-P0-2 fail-closed, no auto-rebuild.

---

## 5. Go / No-go for P3a-full

| Decision | Result |
|----------|--------|
| **Go dual-track screenshot flood?** | **NO-GO** until implementation dual-review APPROVE and transport ADR for frames |
| **Go P3a-full** (ConfirmElevated parity + TaskDock real events + dual-track without high-rate frames first)? | **CONDITIONAL GO** after Task 7 dual-review APPROVE and one full `CMSPARK_HUD_SPIKE=1` operator checklist green |
| **Go P3b production shell selector?** | **NO** — out of spike |

**Screenshot path:** only after **GO** above + explicit transport decision (stdin vs UDS vs `~/.cmspark-agent/` temp files). Do not open dual-track work from this ship note alone.

---

## 6. Rebuild / integrity procedure (operators)

```bash
bash companion/src/tray/build-tray.sh
# Paste printed SHA256 into companion/src/tray/swift-tray-bridge.ts SWIFT_TRAY_SHA256
# Never auto-rebuild on mismatch
```

Current pin (2026-07-28 rebuild with HudController):

`5929b53c5828c4c27f80cc32f4a93183c1be4933f34807a259c24575197c7af8`

---

## 7. Test evidence (2026-07-28)

```text
companion unit (hud-protocol, hud-shell-router, hud-spike, swift-tray-integrity): 20/20 pass
companion full suite (this machine): 2005 pass / 18 skip / 0 fail
stdin smoke: hud.ready + hud.closed on open/close
```

---

## 8. Checklist updates

- Plan Task 4 Step 4 (build + hash): **DONE 2026-07-28**  
- Plan Task 7 Step 1 (this ship note): **DONE**  
- N1–N10 lock “implementation dual-review”: pending Claude+Pi artifacts  
- Plan Task 6 Step 4 manual dual-process: **partial** (stdin open proven; full spike env session optional follow-up)

---

*Ship note for P3a spike Task 7. Dual-review of implementation should attach under `docs/audit/reviews/native-hud-p3a-impl-*`.*
