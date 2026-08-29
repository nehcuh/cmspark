# Dual re-review — CMspark 0.5.3 Batch D path (#249)

You are an **independent** senior reviewer. You did **not** write the strawman or the four-lane synthesis. Confirm, refute, or block the **path**.

Work in: `/Users/huchen/.grok/worktrees/projects-cmspark/fix-249-runtime-p1`

## Capability declaration

```text
Surface:      Capture overlay HTTP ; Operate WS peer
L2-classes:   n/a
Compose:      skill index
Autonomy:     n/a
Trust:        overlay token not in argv ; POST Origin not null/empty
Channel:      community
Blast:        T3
```

## Inputs

1. Spec (folded): `docs/superpowers/specs/2026-08-29-post-diagnosis-batch-d.md`
2. Synthesis: `docs/audit/reviews/batch-d-adversary-synthesis-2026-08-29.md`
3. Spot-check: `skill-engine.ts` new ThreadManager, `thread-manager.ts` get()+saveIndex, `lifecycle.ts` close abort + sendToExtension, `message-router.ts` file.upload, `summoner-web.ts` originOk, `shell-open.ts` --app, `context-budget.ts` shrink

## Rules

1. REJECT if implementing as written would: copy full `chat.abort` onto WS close (kills other face / confirm desk); header-only overlay token (first paint 403); `broadcastToClients` including `security.confirmation.*`; schema-require cookie Secure on http://127.0.0.1; change SUMMONER_ALLOW / overlay Allow/Deny.
2. D3 still must take token out of `--app` argv (product sentence). Skeptic “argv not T3” does **not** delete D3.
3. D4 must not rewrite `untrustedSuffix` `"x"` as a blocker.
4. Final line exactly:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT

## Required sections
## Verdict rationale
## Confirmed pins
## Missing / still BLOCK
## Nits
## Recalibrated: implement now? YES only if APPROVE*
