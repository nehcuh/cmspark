Full suite: 3959 tests, 0 fail `[executed]`. Review complete — findings below.

---

# Node 2 dual re-review — CMspark W1e implementation

**Scope**: `fix/shell-allowlist-w1e` — T-join + L-b + L-c in `companion/src/capability/shell.ts`, L-a dropped, fallback-allow deleted.

## REJECT criteria — all clear

**1. The five adversarial payloads** — all `commandMatchesAllowlistEntry(...) === false` on bare entries, verified by direct execution `[executed]`:

| Payload | Result | Closing layer |
|---|---|---|
| `bash '-c' 'echo PWNED' '*'` | false | L-c (`*` → tokenize null → deny) |
| `bash -""c "echo pwned"` | false | T-join (`-""c` → token `-c`) + L-b belt |
| `bash "-"c "echo PWNED" X=1` | false | T-join (`"-"c` → token `-c`) |
| `python3 -""c "import os"` | false | T-join + interpreter deny |
| `bash -\c echo pwned` | false | **L-b load-bearing**: tokenizer keeps `-\c` (Windows-safe) → normalize consumes `\` → `-c` |

**2. I2 legal forms stay true** `[executed]`: `bash -e script.sh`, `bash -eu`, `bash script.sh`, `grep -ic`, `grep -c pattern file`, `wc -c file`, `ruby -r set x.rb`, `pwsh -File x.ps1`, `deno run x.ts`, `bash -e "a b"`.

**3. Windows B2 intact** `[executed]`: `python "C:\Users\t\script.py" --flag` → `["python","C:\\Users\\t\\script.py","--flag"]`; quote-internal `\U`/`\t` untouched (escape only fires on `\"`/`'`/`\\`). B2 test green.

**4. Fallback-allow deleted** `[inspected + executed]`: `rawArgsHaveDeniedShellFlags` / `rawArgsHaveDeniedInterpreterFlags` gone from src *and* tests (zero grep hits repo-wide); `commandMatchesAllowlistEntry` returns false on tokenize-null (shell.ts:353). W1b both-allow-lines now assert false.

## Layer implementation verified

- **T-join** (shell.ts:506–548): word-loop rewrite — quoted spans append to the same buffer, word ends only on IFS. Join is deny-monotone (merged tokens only add deny inputs). `"foo""bar"` → `["foobar"]` pinned at parse level.
- **L-b** (shell.ts:207–219, first line at :222 and :310): unexported, drops `'`/`"`, `\` consumes next char. Both matchers in lock-step.
- **L-c** (shell.ts:352–353): no fallback, no residual allow path.
- **L-a correctly dropped** `[inspected]`: `SHELL_ALLOWLIST_METACHAR_RE` unchanged (`/[;|&`$()<>\n\r]/`, shell.ts:153) — no `*?~` added.
- **Comments/CHANGELOG** `[inspected]`: "theoretical only" and "W1d CLOSES this class" deleted; new boundary text states matcher-is-last-line-when-L2-skipped + declared residuals; no "≡ /bin/sh"/"CLOSED" phrasing; Unreleased Security + Known residuals match spec.
- **Node 1 nits all folded** `[inspected]`: python3 policy row added (`commandAllowedByPolicy('python3 -""c …')` ok false), W1b test renamed, no-`~` comments present, `p1-deep-diagnosis-batch` in the run.

## Tests

Targeted: 42 + 4 = **46/46 green** `[executed]`. Full companion suite: **3959 tests, 0 fail** `[executed]`.

## Nits (non-blocking)

1. **Mid-word quote tightening beyond spec's named examples.** Old tokenizer recognized quotes only at word-start, so `echo don't` tokenized `["echo","don't"]` → matcher true; new tokenizer opens a quote span mid-word → unclosed → null → false under allowlist. Fail-closed direction, consistent with the function's documented "null on unclosed quotes" contract, and community default (`confirm_per_command`) is unaffected — but it's a tightening slightly wider than the spec's declared behavior change (`grep 'foo*bar'` / `echo '*'` / curl query-string). Worth one CHANGELOG clause if W1e lands publicly.
2. Nit-level: `-\c` closure depends on the two layers agreeing on backslash semantics (tokenizer preserves, normalize consumes). They're separately tested, but a future edit to either alone reopens the vector silently — the existing T-join/L-b test rows cover it, so acceptable as-is.

VERDICT: APPROVE_WITH_NITS
