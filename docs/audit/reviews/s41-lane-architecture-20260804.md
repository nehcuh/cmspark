# Architecture / Devil’s-Advocate Review — S41 (2e7cf2f..79d7420)

| Field | Value |
|-------|--------|
| Lane | Architecture (ADR-020 axis fit, Pack-first, coupling, Trust monotonicity) |
| Range | `2e7cf2f..79d7420` |
| Diff | `/tmp/cmspark-review-s41/code.diff` (~25 files, +1849/−191) |
| Plans | S40 quad AFK; Outbound MCP Phase 0 spike |
| ADR | [ADR-020](docs/adr/020-capability-model-three-axes.md) three axes |
| Prior | Dual M1 REJECT (routing + path Trust); M1c Pi **APPROVE_WITH_NITS** |

---

## Architectural Status: **WATCH**

Not **CLEAR**: Trust packaging for `skill_install` is incomplete relative to ADR-020 checklist (write + read chain, zip budget, allowlist looseness); god-file / inject-helper coupling continues; outbound facade leaves a session-trust landmine for the next wire-up PR.

Not **BLOCK**: No new runtime/Agent type; no new Side Panel 一级入口; outbound MCP unwired (Composition export skeleton only); FocusBand reuses Zone B; shell argv is a Trust reduction with L2 forceConfirm retained; plan DoD tracks map cleanly onto Surface chrome / Composition / Trust residual.

---

## Capability declaration (this batch) — axis fit

| Piece | Surface | Composition | Autonomy | Trust | Channel | Pack-first? |
|-------|---------|-------------|----------|-------|---------|-------------|
| ST-4 FocusBand `thread_tools` | L0/L1 chrome visibility only | — | none | — | community | N/A (chrome, not scene) |
| DL-3/4 downloads hints + conflict | L1 browser download path | steers → skill_install | none | multi-hit ambiguity surfaced | community | OK (tool notes, not panel) |
| `skill_install` | L0 local skills write | **Skills install primitive** | none | source path allowlist (partial); no L2 | community | OK — no marketplace UI |
| shell P1b argv | L2 shell (enterprise module) | — | none | spawn shell:false when safe; L2 token retained | enterprise when shell on | N/A |
| Outbound MCP Phase 0 | L1 tools *when* bridged (not now) | **export façade** of existing loop | none | profile forbid shell/host/cookies; disclosure flag | community | N/A (spike) |
| Shell card / cookie UX / Anthropic probe | UI / config | — | none | cookie ≠ auto_approve clarified | community | **out of S40 plan** (scope noise) |

**Verdict on axis language:** Plan table and `SKILL_INSTALL_CAPABILITY` constant match ADR-020. Code does **not** invent a third Agent runtime or Mission Board fork. Outbound is correctly *not* “Browser MCP clone as product Surface.”

---

## Findings

### F1 — Trust: `content` bypasses source allowlist; permanent Composition write without HITL or audit  
**Severity:** Medium-High (Trust packaging)  
**Where:** `companion/src/skills/skill-install.ts:114-127`, `249-274`; `companion/src/server.ts:3244-3263`; chain `use_skill` `server.ts:3340-3349` + `skill-engine.ts:348-351` (`loadContent` returns raw body, no sanitizer).

`path`/`zip_path` are gated by `isSkillInstallSourceAllowed`; **`content` is not**. LLM can install arbitrary markdown into `~/.cmspark-agent/skills` with zero confirmation, zero `appendCapabilityAudit`, then re-read via ungated `use_skill`. Panel `skill.import` already allowed content over WS (user gesture), but **agent-loop write** is a different Trust packaging: permanent prompt foothold + optional exfil of previously imported secrets if path allowlist ever loosens.

ADR-020 Trust: Pack/Composition must not silently widen blast radius. Declared mitigation “source path allowlist” is incomplete while `content` ships.

**Ask:** Either (a) drop `content` from LLM tool (keep panel import), or (b) require L2/light confirm + audit line for all install modes, and sanitize on `use_skill` load.

---

### F2 — Trust: Downloads allowlist is segment-name heuristics, not a trust root  
**Severity:** Medium  
**Where:** `companion/src/skills/skill-install.ts:48-70`

```ts
if (segments.includes("downloads") || segments.includes("下载")) return true
// + entire os.tmpdir() + getConfigDir()
```

Any path with a `downloads` segment (e.g. `D:\projects\downloads\…`, repo fixtures) is allowed after `realpath`. Entire TMP is open. Combined with F1/`use_skill`, this is a **read-via-install** channel weaker than `host_read` L2 — dual M1 B2 residual, only partially closed.

**Ask:** Bind to known Downloads roots (Chrome download dir / `os.homedir()/Downloads` / platform XDG) + realpath prefix; do not match arbitrary segment names.

---

### F3 — Trust: Zip bomb / extract budget hole contradicts declared Trust  
**Severity:** Medium  
**Where:** `skill-install.ts:151-156` (compressed 25MB only); dir branch uses `assertDirBudget` at `:202-207`; `skill-engine.ts:824-888` extract has zip-slip checks but **no decompressed byte/file cap**.

Declared `SKILL_INSTALL_CAPABILITY.Trust` claims “zip/dir size caps.” Dir yes; zip no post-extract budget → disk fill under user skills root (persistence, not just tmp).

**Ask:** After `importSkillFolder`, run budget walk on dest or stream-count while extracting; fail closed + cleanup.

---

### F4 — Coupling / naming debt: `skill_install` piggybacks on browser-download inject helper  
**Severity:** Low-Medium (maintainability / god-helper)  
**Where:** `companion/src/bridge/tool-definitions-inject.ts:1-20` (`ensureBrowserDownloadTool` now injects browser_download + downloads_find + **skill_install**).

Semantic coupling “GitHub zip → install skill” is product-correct for Track 3, but the helper name and file ownership encode a hidden pipeline. Next inject will grow this further instead of a real catalog registry.

**Ask:** Rename to `ensureCompanionInjectedTools` (or fold into `getAllToolDefinitions` single registry) before the next tool.

---

### F5 — God-file growth: `server.ts` / `message-router.ts` keep absorbing surface  
**Severity:** Low-Medium (ADR-020 governance metric: new WS/runtime pressure; architecture debt)  
**Where:**  
- `server.ts:2161-2188` COMPANION_TOOLS + `:3244` case — pattern continues (diagnosis already flagged ~5k god-object).  
- `message-router.ts` +Anthropic protocol flatten + `probeLlmConnection` + extra_headers redaction (`:1641+`, `:1723-1782`) — **outside S40 plan**, mixed into same range.

No new WS message *family* (good). Still: every Composition tool lands as another `case` next to L2 shell/CU. Autonomy/Board already live here; skill_install does not extract a thin `skills/handlers` boundary.

**Ask:** Track extract of companion tool dispatch map (name → handler + gate metadata) as debt; do not block this PR solely for size, but do not claim architecture is getting cleaner.

---

### F6 — Outbound MCP: Composition export is correct; session disclosure is a Phase-1 landmine  
**Severity:** Medium if mis-shipped; **Low now** (unwired)  
**Where:** `companion/src/outbound-mcp/profile.ts:7-16` (8 L1 tools); `facade.ts:47-105`; `audit.ts:17-28`; plan §5 defers live WS + tray confirm.

**Good:** Fail-closed profile; forbids shell/host/cookies/evaluate/skill_install; no `server.ts` bridge; not a second runtime; matches ADR-020 “MCP = Composition.”

**Devil’s advocate:** `disclosure_accepted?: boolean` is **caller-supplied** (`facade.ts:75`). Any future stdio/WS adapter that trusts the external agent’s flag re-creates L3 disclosure as a free bool — same class of bug as LLM `user_confirmed` on shell (explicitly rejected in server comments).

**Ask:** Before any bridge PR: server-side session grant (origin-bound, non-LLM-settable) + real `confirm_outcome` in audit (today always `"n/a"` even on “ok: true” gate pass).

---

### F7 — Audit type hole on outbound path  
**Severity:** Low  
**Where:** `outbound-mcp/audit.ts:18-27` (`as any` into `appendCapabilityAudit`).

Schema discipline for capability-audit.jsonl erodes; silent field drift when Phase 1 adds confirm outcomes.

**Ask:** Extend `CapabilityAuditEvent` union or a typed outbound event without `as any`.

---

### F8 — Pack-first / primary UI: **held** (positive)  
**Severity:** n/a  

- FocusBand `thread_tools` is priority under Confirm → L2 → Fleet (`focus-band-priority.ts:61-99`); reuses Zone B ≤80px; **not** a new Header/BottomBar 一级入口.  
- No Skill Marketplace panel; install is LLM tool + existing downloads path.  
- Outbound not default-on product.  
- Shell card is chat ToolCallCard chrome (Surface), not a new mode.

Matches ADR-020 anti-pattern #1 avoidance and plan non-goals.

---

### F9 — Shell argv: Trust reduction, residual shell:true intentional  
**Severity:** Low (document, do not re-litigate win32 without new evidence)  
**Where:** `companion/src/capability/shell.ts:tryParseSimpleArgv` / `shouldUseArgvSpawn` / `shellExec` `:264-270`; still L2 `security_token` at `server.ts:3265+`.

win32 limited to `.exe`/`.com`; bare names / `.bat` stay `shell:true` (Pi N1/N1b). Metachar ban retained for allowlist string mode. **Does not** relax forceConfirm / god-mode shell policy.

Residual: POSIX `~/…`, env-prefix, builtins documented as N1c nits — behavioral change under argv, not Trust elevation.

---

### F10 — Pack / thread whitelist interaction underspecified  
**Severity:** Low  
**Where:** `server.ts:568-587` `isToolAllowed`; `skill_install` always in global catalog via inject.

Default `tool_whitelist: null` ⇒ tool always available → **any thread can permanently mutate global skill library**. Packs that omit it from whitelist correctly block; most threads are not pack-bound.

Not a BLOCK for Phase 0 of install, but Composition mutation is **global**, not thread-scoped — stronger blast than “scene recipe.”

**Ask:** Document global vs thread scope; consider audit + optional confirm; Pack docs should list `skill_install` if scenes must freeze skill set.

---

### F11 — Range is multi-theme (reviewability / axis declaration hygiene)  
**Severity:** Low (process)  

Same tip mixes S40 tracks + Anthropic connection probe + SettingsSlideout + cookie trust copy + shell cards. Axis declaration in AFK plan covers S40 only; cookie/Anthropic lack explicit checklist rows. Harder for dual-review to claim “ADR-020 complete for this PR.”

---

## Hidden couplings (summary)

| Coupling | Risk |
|----------|------|
| downloads_find / browser_download descriptions → `skill_install` | Agent steered into install; OK if install Trust solid (F1–F3) |
| `ensureBrowserDownloadTool` multi-inject | Catalog ownership blur (F4) |
| skill_install → SkillEngine.import* → use_skill loadContent | Write/read Composition loop without L2 (F1) |
| outbound gate → future createToolExecutor | Must re-enter same L2/origin path; not dual-dispatch (F6) |
| FocusBand primary `thread_tools` vs L1 context | Context strip suppressed while tools run — intentional ST-4; Confirm/L2 still win |

---

## Strongest counterargument against approving as-is

> “M1c already APPROVE_WITH_NITS and suites are green” is not an architecture argument. This range **ships the first agent-callable permanent skill-library write**. Path allowlist was bolted on after dual REJECT, but **`content` remains a complete Trust bypass**, zip extract budget is declared but not implemented, and Downloads matching is a string-segment heuristic. Meanwhile `use_skill` still returns unsanitized full skill bodies. Relative to Surface L2 (`host_read` / `shell_exec` forceConfirm), Composition write is **less gated** than host read — inverted trust monotonicity for “install third-party methodology that then steers tools.” Outbound MCP is honestly scaffolded, but FocusBand + green tests make the batch *feel* finished while the lasting attack surface is the install→use chain, not the FocusBand pixel budget. Approving as-is freezes that inversion into main until a follow-up that may never get scheduled.

---

## Recommendation: **APPROVE_WITH_NITS**

| Option | When |
|--------|------|
| **REQUEST_CHANGES** | If merge policy requires Trust declaration to match code *before* first `skill_install` ship: fix F1 (content) + F3 (zip budget) minimum; F2 preferred. |
| **APPROVE_WITH_NITS** (this lane) | Accept ship with explicit residual HANDOFF: F1/F2/F3 tracked; no bridge of outbound without F6 session grant; no new panel for skills. Matches Phase 0 honesty on MCP and post-M1c trajectory. |
| **APPROVE** | Only if product explicitly accepts “LLM may freely mutate user skills library like record_experience” **and** documents it in ADR/user guide — not currently explicit beyond the tool description. |

**Architecture lane pick:** **APPROVE_WITH_NITS** + **WATCH**.  
Do **not** BLOCK on axis mis-placement (axes are correct). Do **push** Trust packaging nits so the next dual does not re-discover M1 B2 under a new name.

### Merge blockers for *architecture* (none hard, two soft)

1. Soft: F1 content + F3 zip budget before marketing “safe skill_install from GitHub ZIP.”  
2. Soft: F6 checklist item on any outbound wire-up PR (fail review if `disclosure_accepted` remains client-set).

### Non-findings (explicit pass)

- No new Side Panel 一级 entry (FocusBand reuse).  
- No new Agent/runtime type; skill_install is Composition.  
- Outbound not a parallel tool-loop; scaffold-only.  
- Shell L2 forceConfirm preserved.  
- Pack-first: no scene delivered as permanent chrome.  
- COMPANION_TOOLS wiring present (M1 B1 fixed) at `server.ts:2168` + case `:3244`.

---

## Suggested residual HANDOFF (for main reviewer)

1. skill_install: confirm-or-drop `content`; tighten Downloads root; post-extract budget; capability-audit line.  
2. use_skill: apply content sanitizer on load (or document intentional raw).  
3. Rename inject helper; plan companion-tool registry extract.  
4. Outbound P1: origin-bound disclosure grant before stdio product.  

---

*Lane complete. Evidence: static inspection of diff + live sources + ADR-020 + S40 plans + prior M1/M1c reviews. Not re-executed full test suite in this lane.*
