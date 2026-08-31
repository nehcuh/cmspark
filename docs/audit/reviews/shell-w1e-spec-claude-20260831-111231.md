Review complete. All inputs read; vectors traced against live `shell.ts`.

## Verdict rationale

The three folded layers are individually necessary, collectively sufficient for the enumerated Rule-2 grammar set, and each is independently forced by distinct DoD rows — no layer can be skipped while keeping the suite green.

Traced against live code `[inspected]`:

- **Fail-open confirmed.** `SHELL_ALLOWLIST_METACHAR_RE` (shell.ts:153) lacks `*`/`?`, so `bash '-c' 'echo PWNED' '*'` passes the metachar gate → `tokenizeSimpleArgv` nulls on `*` → `rawArgsHaveDeniedShellFlags` whitespace-splits `'-c'` which never `=== "-c"` → matcher true → `tryParseSimpleArgv` also nulls → `spawn(command, {shell:true})`. The spec's claim that the "theoretical only" comment (shell.ts:256-260) is false is accurate.
- **T-join is required and correctly placed.** Today `"-"c` tokenizes as two tokens `-`,`c`; neither matches posix deny. Only tokenizer-level join closes rows 5/6/8, and row 11 (`"foo""bar"` → `["foobar"]`) pins it at parse level so it can't be faked in the matcher. Join is deny-monotone: merged tokens only add deny inputs, no previously-denied payload becomes allowed.
- **L-b reach is right.** `-""c` and `-\c` arrive as single unquoted tokens; quote-drop/escape-consume before compare closes them on shell *and* interpreter matchers (rows 3/4/7/9). No I2 pattern contains quotes/backslashes in flag position, so no legit regression.
- **L-c is forced uniquely.** Rows 1/2 could be greenered by the dropped L-a (`*?` into metachar RE), but row 10 (`echo 'unterminated` — no wildcard, no deny flag) only flips via tokenize-null→false. W1b both-allow-lines flip pins the fallback deletion.
- **Blast radius contained.** `tokenizeSimpleArgv` has exactly two callers (matcher, `tryParseSimpleArgv`); B2 Windows-path test is quote-internal (join fires only on non-IFS after closing quote) — unaffected. Only other matcher/policy tests are in the two named files; `packs-engine.test.ts` uses `confirm_per_command` and never hits the matcher. No hidden green-test flips beyond the declared W1b pair.

## Confirmed pins

All five synthesis BLOCK pins are in the numbered DoD: `"-"c X=1` matcher+policy (rows 5 + policy block), `"-l"c` clustered (row 6), `python3 "-"c X=1` / `python3 -""c` no-`~` (rows 8/7), W1b both allow lines false, unclosed-quote L-c-unique probe (row 10). Folded decisions honored: L-a explicitly forbidden, no "CLOSED/≡" phrasing (residuals listed instead), comment deletions specified, `normalizeShellTokenForFlagMatch` unexported as first line of both matchers, adapter #4 in non-goals.

## Missing / still BLOCK

None.

## Nits

1. **I1 vs policy block asymmetry.** I1 promises policy-level false under `enableShellAllowlist(["python3"])` but the policy test block only exercises `["bash"]`. Add one python3 policy row or soften I1.
2. **Row 4 backslash literal ambiguity.** Markdown `bash -\\c` is unclear (runtime `-\c` vs `-\\c`); the two readings demand different normalize semantics (drop-keep vs drop-both). Both deny-safe, but pin the intended TS literal and state the escape rule precisely in the spec text.
3. **Stale framing.** After L-c the batch-c-host-p1 test "W1b: fallback path (unparseable argv) applies the same shell deny flags" passes but its name/comment describes a deleted path — fold a rename into the W1b update.

## Recalibrated: implement now?

YES — nits are spec-text edits foldable during implementation without re-review. Calibration held: T3 last-line-of-allowlist framing in the Buffering section is correct; residuals (positional/GTFOBins, `$VAR` under shell:true, win32 cmd grammar, `[c]` glob, `{c,}` brace) are declared, not silently dropped.

VERDICT: APPROVE_WITH_NITS
