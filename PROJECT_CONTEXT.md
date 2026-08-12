# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-12 (session-end · daemon lock · #180 OPEN)
- **Branch**: `fix/daemon-acquirelock-idempotent` @ **`e2c8dd4`**
- **PR**: https://github.com/nehcuh/cmspark/pull/180 — acquireLock same-process re-acquire (OPS-02 self-lock)
- **Symptom**: tray up, `:23401` never listens; `already_running` with **own PID**
- **Local**: `/Applications/CMspark.app` hot-patched + adhoc resign; tray/daemon/extension verified connected
- **Main tip**: `origin/main` @ **`826e4c8`** (#179 meeting STT hotfix already merged)
- **CI leave**: ubuntu+macos smoke pass; **build + windows still pending**
- **Next**: CI green → merge #180 → clean package/DMG (replace hot patch)
- **Do not commit**: `dist/` · meeting dual-review giant `.patch` · `scripts/_install-local-app.sh` unless intentional

### 2026-08-12 (prior · meeting STT hotfix · #179)
- **#179 MERGED** to main as `826e4c8` — soft-continue/pin/双ack + live AI refine/smart segment
- Prior handoff branch `fix/meeting-stt-hotfix-refine-absorb` is historical
<!-- handoff:end -->
