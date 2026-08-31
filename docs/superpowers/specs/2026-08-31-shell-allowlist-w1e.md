# Spec: shell allowlist W1e — exec-flag deny vs spawn(shell:true) quote grammar

**Date**: 2026-08-31  
**Status**: IMPLEMENTED (Node 1 Claude+Kimi AWN; Node 2 Claude AWN + Kimi APPROVE; 4-lane replay AWN)  
**Blast**: T3  
**Synthesis**: `docs/audit/reviews/shell-w1e-adversary-synthesis-2026-08-31.md`

## Capability declaration (ADR-020)

```text
Surface:      L2 shell_exec (existing; no new tool)
L2-classes:   shell
Compose:      none
Autonomy:     n/a
Trust:        allowlist last-line when L2 skipped (enterprise auto-approve / session trust)
Channel:      enterprise (policy=allowlist); community default unchanged
```

## What this closes (narrow)

Bare interpreter/shell allowlist entries must deny exec-flags when the operator writes them with:

- wrapping quotes (`'-c'`)
- intra-token empty quotes (`-""c`, `-l""c`)
- backslash (`-\c`)
- POSIX adjacent-quote concatenation (`"-"c`, `"-l"c`)
- tokenizer poison that previously *failed open* (`*`/`?` → tokenize null → whitespace fallback kept `'-c'`)

**0.5.4 closed flag *variants* (pwsh prefixes, `/c`, `=`, `.exe`, node `-p`, …). It did not close quote/join ≠ spawn grammar.** Comment `:256-260` “theoretical only because wildcards are rejected upstream” is false.

## What this does NOT close (CHANGELOG residuals)

- Positional `bash evil.sh` / GTFOBins (declared; L2 is the gate when present)
- `$VAR` expansion under remaining `shell:true`
- win32 `cmd.exe` quote grammar (`^`, `%VAR%`)
- pathname glob of `[c]` in a flag token (`bash -[c]`) — cwd-dependent
- bash brace `-{c,}` (macOS `/bin/sh` bashism, not POSIX)

Do **not** write “tokenizer ≡ /bin/sh” or “this class CLOSED”.

## Buffering (not a waive)

Default `confirm_per_command` + L2 `forceConfirm`. Not a community default RCE. Last line iff `policy=allowlist` + bare interpreter in the list + L2 skipped.

## Design (FOLDED — two required layers + tokenizer join)

### T-join — POSIX adjacent-quote word join in `tokenizeSimpleArgv`

After a quoted span, if the next char is **not** IFS, continue the **same word** (sh concatenation).

- `"-"c` → `-c`
- `"-l"c` → `-lc`
- `"foo""bar"` → `foobar` (argv-spawn becomes more POSIX-correct; add a parse test)

Do **not** change Windows path backslash-inside-quotes (existing B2 test).

### L-b — Normalize token before flag compare

Unexported `normalizeShellTokenForFlagMatch`: drop `'`/`"`; `\` consumes next char. First line of **both** `tokenIsDeniedShellFlag` and `tokenIsDeniedInterpreterFlag` (tokenized and any leftover fallback stay in lock-step).

Closes `-""c` and `-\c` on a **single** unquoted token.

### L-c — Unparseable argv is deny

`commandMatchesAllowlistEntry`: `tokenizeSimpleArgv` null → `return false`. Delete whitespace fallback **allow**. Delete `rawArgsHaveDeniedShellFlags` / `rawArgsHaveDeniedInterpreterFlags` if unused.

**Behavior change:** `grep 'foo*bar'` / `echo '*'` / `curl 'http://x?y=1'` currently matcher-true via fallback; after L-c they are false (tokenize already nulls on `*?`). Error is not-in-allowlist, not metachar. Document. Operators who need glob/query-string use `confirm_per_command` or a more specific allowlist entry that does not rely on fallback.

Do **not** add `*?~` to `SHELL_ALLOWLIST_METACHAR_RE` (L-a dropped: quote-blind URL/`~/` blast without extra close of A/B).

## Invariants

1. **I1** Named payloads below → `commandMatchesAllowlistEntry` false; policy-level cases → `commandAllowedByPolicy` ok false under `enableShellAllowlist(["bash"])` / `["python3"]`.
2. **I2** `bash -e script.sh`, `bash -eu`, `grep -ic`, `grep -c pattern file`, `wc -c file`, `ruby -r`, `bash script.sh`, `pwsh -File`, `deno run` stay matcher-true.
3. **I3** `python3 '-c' 'code'` and `bash -c 'id'` stay false.
4. **I4** P1a metachar `;|&`$()<>` newlines unchanged.
5. **I5** `confirm_per_command` still allows chaining / `echo *` (metachar ban allowlist-only).
6. **I6** Positional residual unchanged.

## Tests (RED first)

### Matcher W1e (`batch-c-host-p1.test.ts`)

| # | Assertion | Forces |
|---|-----------|--------|
| 1 | `bash '-c' 'echo PWNED' '*'` false | L-c (A) |
| 2 | `bash '-c' 'echo PWNED' '?'` false | L-c |
| 3 | `bash -""c "echo pwned"` false (**no** `~`) | L-b |
| 4 | `bash -\\c echo pwned` false | L-b `\` |
| 5 | `bash "-"c "echo PWNED" X=1` false | T-join |
| 6 | `bash "-l"c "echo PWNED" X=1` false | T-join clustered |
| 7 | `python3 -""c "import os"` false (**no** `~`) | interpreter L-b |
| 8 | `python3 "-"c "import os" X=1` false | interpreter T-join |
| 9 | `node -""e "1"` / `sh -""c "id"` / `deno -""e "1"` false | cousins |
| 10 | `echo 'unterminated` false | L-c unique (no deny-flag, no `*?`) |
| 11 | `tryParseSimpleArgv('"foo""bar"')` → `["foobar"]` | T-join argv |

### W1b update (L-c)

Both currently-true lines become false:

- `commandMatchesAllowlistEntry("bash -e 'a|b'", "bash") === false`
- `commandMatchesAllowlistEntry("grep -c 'a|b'", "grep") === false`

Comment: policy already owns `|`; matcher fail-closed is the point. W1b-deny rows stay false.

### Policy (`capability-shell-netsec.test.ts`)

`enableShellAllowlist(["bash"])`:

- `commandAllowedByPolicy("bash '-c' 'echo PWNED' '*'")` ok false
- `commandAllowedByPolicy('bash "-"c "echo PWNED" X=1')` ok false

Optional: `shellExec` of vector A, `success:false`, stdout not `PWNED`.

I5: under `confirm_per_command`, `commandAllowedByPolicy("echo *")` still ok.

Regressions: C3 / W1 / W1c / W1d / P1a stay green.

## Comments / CHANGELOG

- Delete “theoretical only” and “W1d CLOSES this class”. Restate: flag deny is DiD except when L2 is skipped, in which case match must fail-closed on unparseable argv and POSIX-join quotes before flag compare.
- Unreleased Security: quoted/empty-quote/backslash/adjacent-quote exec-flags no longer match a bare interpreter entry; unparseable argv deny. Not a default-install RCE. 0.5.4 closed variants not quote-join.
- Residuals: list the “does NOT close” set above.

## Non-goals

adapter `#4`, ADR-022, whisper, P1b shell:false for all allowlist, GTFOBins, `[` as metachar.
