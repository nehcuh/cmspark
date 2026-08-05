# Dual review: User scene tools policy + AI create design

**Artifact**: `docs/superpowers/specs/2026-08-06-user-scene-tools-and-ai-create.md` (DRAFT, new untracked file). Patch is a context header only; `git status` confirms branch at HEAD `1b294fe`, files under review are the new spec + review artifacts — not stale. I read the actual engine (`pack-engine.ts`, `validator.ts`, `types.ts`, `suggest-scene.ts`, `thread-manager.ts`, `orchestrator/spawn.ts`, `capability/modules.ts`, `server.ts`, `llm/adapter.ts`, `bridge/tool-definitions.ts`), `PacksPanel.tsx`, ADR-014, and both builtin packs.

---

## Findings by severity

### Security — sound (verified against code, no trust bypass found)

**S1 (Pass) Pack cannot become a Trust bypass.** FORBIDDEN_PACK_KEYS (`types.ts:130-142`) + recursive `scanForbidden` (`validator.ts:59-76`) already reject `auto_approve_*` / god-mode / domain whitelists; §5.2 aligns. Pack never touches modules (`saveUserPack` writes `requires_modules`; `setModuleEnabled` is the only mutator and is enterprise-gated for shell/netsec, `modules.ts:84-94`). L2 per-call confirm paths untouched. No new `securityConfirmations.request` — `pack.save_user` / `pack.suggest_config` are already `user_gesture`-gated RPC (`server.ts:5584-5607`); D3's 高危二次确认 is UI-only. No originWs regression (checklist item 5).

**S2 (Pass) Allowlist-expansion risk contained.** `computeWhitelist` allowlist = whole-table replace (`pack-engine.ts:29-38`) — expansion relative to a narrower current thread is real, but gated fail-closed at apply via `computeApplyBlocked` (`pack-engine.ts:471-485`): `shell_exec`→`requires_modules:[shell]`, `netsec_port_scan`→`netsec`, plus enterprise-profile gate. A community user checking `shell_exec` gets apply-blocked (J1 step 3 copy covers this). The "不是问题" section (§0) is accurate: `unchanged` + null baseline = full surface *only if* module+L2 permit — verified `shell_exec` execution requires module + L2 regardless of whitelist.

**S3 (Pass) No multi-agent bypass.** If a user pack grants shell to an orchestrator thread, `computeWorkerWhitelist` still strips `WORKER_HARD_DENY` (shell_exec/netsec_port_scan/osascript_eval/host_*) from workers (`spawn.ts:29-38`, `constants.ts:16-23`). Consistent with declared `Autonomy: single`.

**S4 (Confirmed, mechanism under-specified — nit) MCP whitelist footgun is real.** Verified all three layers: adapter filters `mcpTools` **and** `mcpMetaTools` by whitelist (`adapter.ts:488-494`); `isToolAllowed` hard-gates `mcp__*` (`thread-manager.ts:559-563`); validator's `knownToolNames` = static native catalog so `mcp__*` cannot even be allowlisted (`validator.ts:24-26`, `tool-definitions.ts:106-113`). D8 + implementation item 0 correctly identifies this first, but the doc does not specify which layers must change (schema filter + hard gate + meta tools). If an implementer fixes only one layer, allowlist+scene still breaks MCP (fail-closed, not a hole). Must be pinned down before item 0 is considered done.

### Product completeness — G1–G4 closed

G1 (D1 read-only builtin + 另存) ✓ · G2 (D2 configurable `tools.mode`) ✓ · G3 (D6 clone preserve, default-off with explicit copy) ✓ · G4 (D7 brief-first generate / recommend / optimize) ✓. Acceptance playbook §9 (10 items) is testable and maps to existing engine behavior (unapply snapshot restore already exists, `pack-engine.ts:796-827`). Implementation order (footgun → save → UI → clone → AI → docs → audit) is sound.

### Feasibility — accurate

Claims verified: engine already has `computeWhitelist`/validator/suggest-scene; `saveUserPack` indeed hardcodes `tools:{mode:"unchanged"}`, `requires_modules:[]` (`pack-engine.ts:333-342`) and `PacksPanel.tsx:151-165` clone mode indeed drops allowlist — G2/G3 are real gaps. No new runtime invented; D5/D8/D9 reuse `computeWhitelist` + validator + `suggest_scene`. Builtin 网络巡检 (`netsec-port-survey`, enterprise + netsec + allowlist + deny shell/evaluate) is cloneable with preserve on — fail-closed either way since requires/channel gate apply.

### ADR-020 checklist — declaration present and correct

§8 declares Surface n/a / Compose pack|skill|mcp-server / Autonomy single / Trust module+profile+L2, Pack 禁 auto_approve / Channel community-declared-enterprise-tools, apply gated. Axes fit (Composition, not Surface), Pack-first (no new "中层 Agent"), no new confirm dialect, no new runtime, no experimental-layer dependency. Checklist form satisfied.

### Nits (non-blocking)

1. **§5.2 requires-module mapping incomplete**: only `shell_exec`→shell and `netsec_port_scan`→netsec are specified; §8 declares `host_computer`/`evaluate`/`osascript_eval` in L2-classes but no derivation rule exists for them (no module object exists — they rely on per-call L2 only). Document that asymmetry explicitly so implementers don't invent a mapping.
2. **Update path stale-requires risk**: §5.1 omit-preserve covers `tools`, but recompute-vs-merge of derived `requires_modules` on update is unspecified — removing shell from allow could leave a stale `requires` → apply blocked (fail-closed but confusing). Specify replace-derived-on-change.
3. **D9 (`use_skill` auto-include) injection point unspecified**: save-time vs `computeWhitelist`-time; must be defined so deny lists can't bypass it (`use_skill` is in catalog, `tool-definitions-catalog.json:610`).
4. **D2/D3 高危分组 source left open** ("tools.catalog 或静态分组"): static grouping suffices for P0; pin it to avoid UI/engine drift.
5. **D6 default-off is deliberate**, but J3/验收 #6 means a preserved-template-less clone of a security scene is 全开 (only module+L2 gates remain) — the doc acknowledges this; ensure the 另存 dialog copy states it plainly (the current `suggestNote` copy at `PacksPanel.tsx:165` already leans this way).

---

No blocking issues: security model is consistent with the shipped engine, declaration is present and truthful, gaps are mechanism-level details on already-acceptance-criteria'd items, all fail closed.

VERDICT: APPROVE_WITH_NITS
