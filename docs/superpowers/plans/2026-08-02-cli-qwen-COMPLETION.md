# Completion report: CLI Phase-2 + Qwen3-VL P0

**Date**: 2026-08-02  
**Branch / worktree**: `feat/cli-qwen-diag-20260802` @ `/Users/huchen/Projects/cmspark-wt-cli-qwen-20260802`  
**Base**: `main` `007130b`  
**Dual-review stop gate**: **PASS** — Claude + Pi `APPROVE_WITH_NITS` (batch `cli-qwen-p0-r4`)

## Delivered

### F2 Qwen3-VL (first)
- Pixel-only coords (no 0–1000 false scale) + Node mirror tests
- `set_enabled(true)` requires `canEnable` → `CANNOT_ENABLE`, zero config write
- `modelEnabled` blocks G1 initial-skip (config-level)
- De-TinyClick user copy; disk budget product copy fixed
- License decline reset via settings (`reset_decline`) + transport validation
- LICENSE_DOOR_TEXT aligned with resettable decline

### F1 Apps CLI Phase-2
- `host_cli` tool + catalog + schemas + three-place L2 wiring
- `cli_manifest` validation, argv-only execFile, env allowlist, option-injection deny
- Q5 taint after CLI output; workers hard-deny; policy cap `ai`
- AppsPanel Segment B UI (path + JSON manifest)
- `host-and-apps.md` updated

## Not merged
Intentionally **not** merged to `main`. User can open PR from worktree branch when ready.

## How to use
```bash
cd /Users/huchen/Projects/cmspark-wt-cli-qwen-20260802
# run companion/extension as usual
npm --prefix companion test   # after npm install if needed
npm --prefix chrome-extension test
```

## Commits (tip)
See `git log --oneline 007130b..HEAD`
