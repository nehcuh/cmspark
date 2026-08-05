# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-05 (S43 — lid-close battery drain diagnosis)
- **No code ship** — diagnostic only
- **Not #91**: companion log gap overnight; no `sidepanel_forward_failed`; logs ~KB not GB
- **Root**: macOS DarkWake thrash (~450/h) via Wi‑Fi `E_RX_IP_PACKET` / `centauri-alpha|beta`; charge 85%→58% overnight
- **Co-factor**: oMLX `omlx-server` ~13GB resident + periodic PreventIdle sleep assertions; exit oMLX does not stop DarkWake
- **Next**: battery-only A/B (unplug AC) with oMLX off; optional disable “Wake for network access”
- **Knowledge**: `memory/project-knowledge.md` §合盖通宵掉电差分诊断

### 2026-08-04 (S42 COMPLETE — #117–#120 on main)
- Main tip around grant M1–M4 / run-state ship; residual: human P0d T1–T3, require_grant GA
<!-- handoff:end -->
