# Dual review: tray/Aqua-owned estop implementation

**Batch:** tray-estop-impl  
**Repo:** /Users/huchen/Projects/cmspark  
**Branch tip:** fix/macos-tcc-product-identity (efed228+)

## Required reading

1. `companion/src/host-use/darwin/host.swift` — `launchAgentTrayAndExit` starts estop child before Node tray  
2. `companion/src/computer/darwin-estop.ts` — connect grace → daemon fallback only  
3. `companion/src/menu-bar-agent.ts` — `startTrayOwnedEstopBestEffort` on tray start  
4. `docs/audit/reviews/computer-use-platform-analysis-20260801.md` §2–4  
5. `docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md`

## Must verify

1. Preferred owner is Aqua `MacOS/CMspark`, not Node daemon  
2. Companion does not unlink tray socket before connect  
3. Daemon spawn is fallback + logged  
4. No user-facing “enable node”  
5. Fail-closed still holds if no estop at all  
6. Tests exist for connect / NO_DAEMON_SPAWN

## Rejection gates

| # | Gate |
|---|------|
| R1 | Daemon spawn remains the preferred/only path |
| R2 | Tray path deletes existing estop socket before connect |
| R3 | Claims on-device host_computer fixed without evidence |
| R4 | Security: estop can be replaced by untrusted binary without resolveHostBinary |

## Output

Summary, Blocking, Nits, then:
VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
