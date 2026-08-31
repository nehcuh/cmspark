# Dual re-review — CMspark W1e implementation (Node 2)

You are an **independent** senior reviewer. You did **not** write this patch. READ-ONLY — do not edit.

Work in: `/Users/huchen/Projects/cmspark` branch `fix/shell-allowlist-w1e`

## Capability

```text
Surface: L2 shell_exec | L2-classes: shell | Blast: T3
Trust: allowlist last-line when L2 skipped
```

## Inputs

1. Folded spec: `docs/superpowers/specs/2026-08-31-shell-allowlist-w1e.md`
2. Diff: `docs/audit/reviews/shell-w1e-impl-20260831-diff.patch` **and** live files (`git diff`)
3. Node 1 dual: `docs/audit/reviews/shell-w1e-spec-claude-20260831-111231.md` and `shell-w1e-spec-kimi-20260831-111231.md` (both AWN)
4. Machine: companion targeted tests 46/46 pass after GREEN (batch-c-host-p1, capability-shell-netsec, shell-progress-windowsHide, p1-deep-diagnosis-batch)

## What must be true

Implementing T-join + L-b + L-c. L-a (`*?~` metachar) was **dropped**. Fallback-allow deleted.

REJECT if any of these still `commandMatchesAllowlistEntry(...) === true` on a bare `bash`/`python3` entry:

- `bash '-c' 'echo PWNED' '*'`
- `bash -""c "echo pwned"`
- `bash "-"c "echo PWNED" X=1`
- `python3 -""c "import os"`
- `bash -\c echo pwned`

REJECT if I2 legal forms (`bash -e script.sh`, `grep -ic`) became false.
REJECT if Windows quoted path backslash test was broken.
REJECT if fallback-allow path still exists.

Nits OK: comment wording, extra residual payloads (`[c]` glob) already declared.

Final line exactly:

VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
