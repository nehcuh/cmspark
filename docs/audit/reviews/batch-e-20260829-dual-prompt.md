# Dual re-review — CMspark 0.5.3 Batch E path (#251)

You are an **independent** senior reviewer. You did **not** write the strawman or the four-lane synthesis. Confirm, refute, or block the **path**.

Work in: `/Users/huchen/.grok/worktrees/projects-cmspark/fix-251-p2`

## Capability declaration

```text
Surface:      Operate WS handshake ; Capture overlay HTTP 不动
L2-classes:   n/a
Compose:      n/a
Autonomy:     n/a
Trust:        chrome-extension Origin never summoner ; tray Origin omit deny
Channel:      community
Blast:        T2
```

## Inputs

1. Spec (folded): `docs/superpowers/specs/2026-08-29-post-diagnosis-batch-e.md`
2. Synthesis: `docs/audit/reviews/batch-e-adversary-synthesis-2026-08-29.md`
3. Spot-check: `lifecycle.ts` handshake + `isAllowedWsOrigin`; `composer-lease.ts` stamp/lease if; `validate.ts` surface enum; `ws-client.ts` / `companion-client.ts` handshake; `protocol.ts`; `run-esbuild-bundle.mjs`; `summoner-acl.ts` ALLOW (must be untouched)

## Rules

1. REJECT if implementing as written would: add overlay HTTP to WS Origin; change SUMMONER_ALLOW / overlay Allow/Deny; split `message-router.ts`; introduce claimed wire `surface:"panel"`; treat omit-deny as unauth RCE; leave extension+`surface:"summoner"` able to claim overlay lease.
2. Calibration: T2 mis-label among HMAC peers, not Critical. Skeptic “HMAC is the real gate” does **not** delete E1 terminate-summoner-from-extension.
3. `__cmspark_surface` stays binary unless you BLOCK that choice with a concrete lease hole the fold missed.
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
