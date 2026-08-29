# Dual re-review — CMspark 0.5.3 Batch C path (#247)

You are an **independent** senior reviewer. You did **not** write the strawman or the four-lane synthesis. Confirm, refute, or block the **path** (not a code patch).

Work in: `/Users/huchen/.grok/worktrees/projects-cmspark/fix-247-host-p1`

## Capability declaration

```text
Surface:      Operate companion tools
L2-classes:   shell | osascript (existing)
Compose:      mcp-server env
Autonomy:     spawn_worker HMAC
Trust:        L2 preview honesty ; token bind
Channel:      community
Blast:        T3
```

## Inputs (read with tools)

1. Spec (folded): `docs/superpowers/specs/2026-08-29-post-diagnosis-batch-c.md`
2. Four-lane synthesis: `docs/audit/reviews/batch-c-adversary-synthesis-2026-08-29.md`
3. Lane notes: `docs/audit/reviews/batch-c-adversary-{security,product,impl,skeptic}-2026-08-29.md`
4. Diagnosis C items: `docs/audit/deep-diagnosis-fanout-2026-08-28.md` (if present) or opt-path spec C/D/E section
5. Issue #247
6. Spot-check live code: `companion-dispatch.ts` osascript, `security-policy.ts` bindingPayloadFor, `l2-admission.ts`, `mcp/transport.ts` buildMcpStdioEnv, `handlers/mcp.ts`, `user-env.ts` USER_ENV_DENYLIST, `capability/shell.ts` BARE_INTERPRETER, `host-use/win/powershell.ts`, `orchestrator/spawn.ts`, catalog `osascript_eval`

## Rules

1. This is a **plan** review. REJECT if implementing as written would: wholesale-copy `USER_ENV_DENYLIST` into MCP env (killing PATH), schema-require osascript `url` (chat-kill), keep AppleScript `contains`, leave HMAC on expression-only while previewing URL, fail-open when `tryParseSimpleArgv` returns null, treat `NODE_ENV` as the Win-scripts gate, or mix D/E / SUMMONER_ALLOW / overlay Allow/Deny.
2. Calibration: Batch C is T3 post-auth integrity, not unauth RCE. Do not inflate C4/C5 to Critical. Do not demand php `-r` / node `-p` / pack composition freeze.
3. If four-lane pins are already folded correctly, say so. If a pin is still missing from the spec, BLOCK.
4. Do not reward long prose.
5. Final line MUST be exactly one of:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT

Use REJECT if C1–C5 DoD would still let Confirm Center lie. Use APPROVE_WITH_NITS if the path is implementable after nits. Use APPROVE only if you would start TDD tomorrow with no spec edits.

## Required sections

## Verdict rationale
## Confirmed pins (folded correctly)
## Missing / still BLOCK
## Nits
## Recalibrated: implement now? YES only if APPROVE*
