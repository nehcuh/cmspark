# S40 AFK Quad-Track Master Plan

> **Date**: 2026-08-03  
> **Mode**: AFK — complete all four tracks; node Pi review; milestone dual Pi+Claude  
> **Base**: main @ `629580e`  
> **User mandate**: tracks 1–4 all required; stop only when DoD below is met

## Locked goals (DoD)

### Track 1 — #au4dch residual UX
- **ST-4**: FocusBand / top area shows **this-thread active tools** (running tool names + elapsed) when any tool `status===running`; not only chat footer label.
- **DL-3** (minimal): browse skill or tool description hints: find Downloads before re-download / prefer skill_install path.
- **DL-4** (minimal): `downloads_find` or prefer_existing path surfaces size/mtime conflict hint when multiple hits differ.
- Tests: pure logic unit tests for active-tool aggregation; extension/companion green on touched suites.
- **Non-goals**: Wave 4 PTY; new Side Panel L1 entry.

### Track 2 — Outbound MCP Server Phase 0
- **P0b**: Spike plan doc (tool whitelist 6–8, metrics sheet, disclosure copy, L1–L9 locks) under `docs/superpowers/plans/` or `docs/decisions/`.
- **P0c minimal**: stdio MCP façade skeleton that (a) lists only curated L1 tools, (b) refuses forbidden tools, (c) leaves audit line, (d) binds origin for confirm path or fails closed — **not** default-on product.
- **P0d**: bake-off protocol sheet only if live SSO not available AFK; mark human T1 deferred with checklist.
- Dual-review on design+spike before claiming Phase 0 complete.
- **Non-goals**: full tool dump; L2 export; CWS; grant model P1.

### Track 3 — Agent skill_install
- LLM tool `skill_install` (or equivalent) with `path` / `zip_path` / optional `url`.
- Always writes under `getConfigDir()/skills`; refresh; return name + abs path.
- Reuse SkillEngine import*; SSRF/size gates for URL like existing import.
- Tests: unit/integration for path containment + happy path mock.
- **Non-goals**: merge with `~/.claude/skills`; new panel entry.

### Track 4 — shell_exec argv (P1b residual)
- Prefer `spawn(cmd, args, { shell: false })` path when command can be safely parsed to argv under allowlist policy.
- Keep `confirm_per_command` L2; god-mode still forceConfirm shell.
- Metachar ban retained for allowlist string mode if any residual string path.
- Tests: allowlist argv success; metachar reject; forceConfirm regression.
- **Non-goals**: interactive PTY; free-args host_cli.

## Execution order

1. Track 1 (low blast)  
2. Track 3 (Composition, clear DoD)  
3. Track 4 (Trust — design adversarial if fork)  
4. Track 2 (Phase 0 docs + spike)  

## Review gates

| Gate | When | Who |
|------|------|-----|
| N1 | After Track 1+3 code | Pi |
| N2 | After Track 4 design+code | Pi |
| M1 | Before PR / merge claim | Pi + Claude dual |

## Stop rule

Do **not** stop until all four DoD sections are green or explicitly blocked with residual HANDOFF + reason.

## Capability declaration (ADR-020) — this batch

| Axis | Declaration |
|------|-------------|
| **Surface** | ST-4 FocusBand = L0/L1 chrome visibility only; skill_install writes L0 local skills; no new L2 tools |
| **Composition** | skill_install installs Skills; outbound MCP Phase 0 is Composition export façade skeleton |
| **Autonomy** | none — no auto-spawn / fleet changes beyond visibility |
| **Trust** | skill_install source path allowlist (Downloads/tmp/data); shell argv win32 .exe/.com only; outbound profile forbid shell/host/cookies |
| **Channel** | community |
| **No new primary Side Panel entry** | FocusBand slot reuses existing chrome region (not a new 一级入口) |

## Review log

| Gate | Result |
|------|--------|
| Pi N1 | REJECT — win32 argv |
| Pi N1b | REJECT — .bat EINVAL |
| Pi N1c | APPROVE_WITH_NITS |
| Dual M1 | REJECT — skill_install not in COMPANION_TOOLS + path Trust |
| Dual M1b | (pending after routing + path allowlist) |
