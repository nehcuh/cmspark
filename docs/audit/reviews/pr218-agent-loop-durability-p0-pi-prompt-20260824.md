# Pi re-review prompt — PR #218

You are Pi. Confirm or reject the independent adversarial REJECT on CMspark PR #218.

**Do not rubber-stamp.** Read the real diff and the adversary report.

- Repo: /Users/huchen/Projects/cmspark
- Diff: `git diff origin/main...HEAD`
- Adversary report: `docs/audit/reviews/pr218-agent-loop-durability-p0-adversary-20260824.md`
- Machine: companion targeted suite 136 pass, exit 0; CI build+smoke green

## Task

1. Verify B1, B2, B3 against code (file:line). If a BLOCK is wrong, say so and downgrade.
2. If any BLOCK stands, keep REJECT.
3. Over-strict nits may be downgraded.
4. Do not APPROVE because tests are green — the adversary claims tests miss the heal/select/omit paths.

End with exactly one line:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
