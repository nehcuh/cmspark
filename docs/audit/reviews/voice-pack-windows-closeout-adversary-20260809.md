# Adversarial closeout — Windows package / voice STT batch

**Range**: `fa0e69c..f6291ba` (on main) + closeout branch fixes  
**Date**: 2026-08-09  
**Blast tier**: T3 (WS fail-closed, local STT, SEA packaging)

## Machine

- voice-whisper-runner / whisper-binary-download / ws-validate-strict: **18 pass** (prior session)
- package gates: run on Unix CI (Windows host lacks bash gates locally)

## Independent adversaries (3-way)

| Path | Verdict | Blocking |
|------|---------|----------|
| Security | APPROVE_WITH_NITS | none |
| Correctness | APPROVE_WITH_NITS | skill.import-* missing validators (fail-closed hole) |
| Product/Ops | **REJECT** | launch.bat always exit 0; large-model honesty |

## Closeout fixes (this branch)

1. `companion/launch.bat` — fail-closed if `127.0.0.1:23401` not LISTENING; point to crash.log  
2. `companion/README.txt` — whisper component + large-model note  
3. `skill.import-folder|path|files` registered under `validateWsMessage`  
4. large-v3-turbo catalog + Settings + user guide honesty (final-only)  
5. whisper child env inherits `process.env` + PATH override  

## Residual accepted

- Binary download redirect follow (not hop-by-hop https)  
- Wire privacy_ack_v2 boolean (extension origin still required)  
- DLL siblings not re-hashed every spawn (install probe only)  
- ggml-org GitHub as publisher of pinned zip  

## Capability (ADR-020)

- Surface: local STT binary download + WS validators (not new high-risk host tool)  
- Trust: no unattended/auto_approve default change  
- Channel: settings-origin + chrome-extension origin fences retained  
