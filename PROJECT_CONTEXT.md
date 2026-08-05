# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-05 (S44 — file upload stuck / ship main)
- **Ship**: `c6b1e8b` on `origin/main` — busy clear + reasoning UI + upload diagnostics
- **Root**: optimistic `isProcessing` without `file.upload_error` handler; env mismatch (App vs source); parseFile OK on ~30–55KB docx
- **Verified**: source companion + chrome-mv3-dev; thread `#ne13jb` full path parsed→chat
- **Next**: bake into CMspark.app release if users stay on packaged build; optional keep diag logs at info or gate behind debug
- **Knowledge**: `memory/project-knowledge.md` §附件上传「思考中」

### 2026-08-05 (S43 — lid-close battery drain diagnosis)
- **No code ship** — diagnostic only
- **Not #91**: companion log gap overnight; no `sidepanel_forward_failed`; logs ~KB not GB
- **Root**: macOS DarkWake thrash (~450/h) via Wi‑Fi `E_RX_IP_PACKET` / `centauri-alpha|beta`; charge 85%→58% overnight
- **Co-factor**: oMLX `omlx-server` ~13GB resident + periodic PreventIdle sleep assertions
- **Next**: battery-only A/B (unplug AC) with oMLX off; optional disable “Wake for network access”
- **Knowledge**: `memory/project-knowledge.md` §合盖通宵掉电差分诊断
<!-- handoff:end -->
