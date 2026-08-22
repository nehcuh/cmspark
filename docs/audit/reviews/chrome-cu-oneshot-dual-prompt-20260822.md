# Dual rereview (Claude + Kimi) — Chrome vault-browser one-shot L2

You are a **second judge**. Confirm or reject independent adversaries. Do not rubber-stamp.

Worktree `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` (`204429e`) vs `origin/main`.

## Blast
T3 Trust. Surface L2 host_computer. Persistent `coordinateAllowed` still impossible on browsers.

## Adversary reports (read FULL)
- `docs/audit/reviews/chrome-cu-oneshot-adversary-trust-20260822.md` **REJECT** (mac persist coordinateAllowed)
- `docs/audit/reviews/chrome-cu-oneshot-adversary-product-20260822.md` APPROVE_WITH_NITS
- `docs/audit/reviews/chrome-cu-oneshot-adversary-runtime-20260822.md` APPROVE_WITH_NITS

## Fold after Trust REJECT (verify in current tree `204429e`)
1. `apps.set_coordinate_allowed` uses `canEverCoordinate(entry)` — mac Chrome bundleId-only DENY; test added
2. `normalizeAppEntry` force-clears via `canEverCoordinate` (bundleId)
3. G1/unattended skip algebra **not entered** for vaultBrowserOneShot (no set-then-wipe)
4. Preview `leadLines` first so Cockpit 1200 slice keeps ⚠️
5. User-guide step 3 exception

## Machine after fold
computer-policy + l2-admission-pure + apps-coordinate + computer-preview + wave1: **95 pass**, tsc 0

## Job
1. Is Trust REJECT folded (mac persist)? If not → you REJECT.
2. Can unattended still skip Chrome L2?
3. Confirm or reject each adversary. Over-loose APPROVE → REJECT.
4. ADR-020 checklist.

End with exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
