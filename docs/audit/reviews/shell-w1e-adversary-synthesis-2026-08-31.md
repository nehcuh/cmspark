# W1e spec — 4-lane synthesis (2026-08-31)

| Lane | VERDICT |
|------|---------|
| Security | REJECT |
| Correctness | REJECT |
| Skeptic | APPROVE_WITH_NITS |
| Impl | APPROVE_WITH_NITS |

## Folded decisions (all lanes)

1. **Required layers = L-b + L-c + tokenizer POSIX adjacent-quote join.** Drop strawman L-a (`*?~` into metachar RE) as a required layer. `*`/`?` already tokenize-null; L-c deny covers A. `~` is not an exec-flag poison.
2. **Tokenizer must join adjacent quoted/unquoted spans** (POSIX `"-"c` → `-c`). Per-token quote-strip does **not** close `bash "-"c "echo PWNED" X=1` (SEC payload 1). Trailing `X=1` forces `shell:true` via existing `tryParseSimpleArgv` ENV= rule.
3. **L-c in `commandMatchesAllowlistEntry`**: tokenize-null → `false`. Delete fallback-allow. Flip W1b **both** allow lines (`bash -e 'a|b'` and `grep -c 'a|b'`).
4. **DoD must force L-b on interpreters without glob/`~` poison** (`python3 -""c "import os"`).
5. **Do not claim “class CLOSED / tokenizer ≡ /bin/sh”.** Narrow close-out. Residuals: positional/GTFOBins, `$VAR`+shell:true, win32 cmd grammar, `[c]` pathname glob, bash `{c,}` brace.
6. **Do not rewrite 0.5.4 history.** Unreleased corrects the close-out: 0.5.4 closed flag *variants*; quote/join mismatch was not closed. Delete “theoretical only” and “W1d CLOSES this class”.
7. **#4 adapter out of scope.**
8. **Do not export** `normalizeShellTokenForFlagMatch`. Call it as first line of both deny matchers.

## Dropped

- L-a quote-blind `*?~` metachar (URL `?`, `grep '*'`, `~/path` as metachar error) — Skeptic: theater; CORR: unpinned blast. L-c already denies raw `*?` at matcher.

## BLOCK pins that were missing from strawman (now in folded spec)

- `bash "-"c "echo PWNED" X=1` matcher false + policy false
- `bash "-l"c … X=1` clustered split
- `python3 "-"c "import os" X=1` and `python3 -""c "import os"` (no `~`)
- W1b allow-path both lines false
- unclosed quote → matcher false (L-c unique probe)
