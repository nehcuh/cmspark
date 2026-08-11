# Dual external review — C10 god-file split Phase A

## Scope
Mechanical extract only (zero intended behavior change) on branch `fix/c10-godfile-split-a`
stacked on multi-adv deep tip (`fix/multi-adv-deep-wave012` / #162).

### Moves
| Phase | Extract | New file | server/router Δ |
|-------|---------|----------|-----------------|
| C10-A | validateWsMessage | `ws/validate.ts` | ~−970 |
| C10-B | executeCompanionTool | `tool/companion-dispatch.ts` + bindCompanionDispatchRuntime | ~−1500 |
| C10-C | config/settings family | `message-router/handlers/config.ts` | ~−328 |

createToolExecutor L2 algebra **stays** in server.ts (next phase).

## Verify
1. Re-exports keep public API: validateWsMessage, executeCompanionTool, bindCompanionDispatchRuntime from server
2. Runtime bind after initServices + seedThreadManagerForTests
3. No L2 algebra / security gate changes
4. WS lockstep test still finds validators (in ws/validate.ts)
5. config family cases still in message-router switch (thin arms) for lockstep

## Tests expected green
lockstep, ws-validate-strict, security-gates, unattended, worker, shell-netsec

REJECT only if behavior/security regression. Prefer APPROVE if pure move.

Final line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
