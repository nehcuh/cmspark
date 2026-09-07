# #464 eval gate — code review loop

Base: `68ccb023012fc154d83bff9426d314e091f20862`; branch `codex/code-review-loop`.
Issue-first implementation: #465 / #466 / #467; broader follow-up #464.

## Capability / blast

T3. Surface L0/L1 + optional existing L2 terminal; L2-classes shell;
Compose pack/user-env; Autonomy single; Trust panel origin + fresh L2 + exact
thread/peer/review binding; Channel community and enterprise browser observations.
Terminal remains default-off and macOS-only. No outbound profile expansion,
new hidden Agent runtime, automated command/patch or business submission.

## Machine — PASS

Node 22.23.2. Commands executed in their respective package directories:

| Command | Observed result |
| --- | --- |
| Companion `npm run build` | exit 0 |
| Companion `npm test` | 4996 pass, 23 skip, 0 fail; separate settings 20 pass; exit 0 |
| Final handler correction `npx tsc -p tsconfig.test.json` + `node --test .test-dist/tests/pty-terminal.test.js` | 23/23, exit 0 |
| Extension `npm run build` | exit 0, includes production tsc and Plasmo |
| Extension `npm test` | 1281/1281, exit 0 |
| Isolated Chrome React/xterm `uv run --no-project --with playwright python scripts/test-terminal-review-ui.py` | exit 0; copy/import/layout/disconnect assertions pass |
| `git diff --check` | exit 0 |

Full Companion was run before the final best-effort notification catch; the
changed handler then passed its targeted regression and production build.
CI will independently run the full latest commit. Logs' hashes and summaries:
[machine-evidence.json](machine-evidence.json). Frozen implementation:
[final-source-manifest.json](final-source-manifest.json).

## Independent judges — PASS

User explicitly replaced unavailable Claude with **Grok 4.6 + DeepSeek V4 Pro**.
This session uses that authorized pair instead of the older skill's Pi sequence.
They receive separate frozen packets without the other judge's conclusions.
Grok uses its CLI `--model grok-4.6`; DeepSeek uses Claude CLI solely as transport
with `--model deepseek-v4-pro`; `modelUsage` is retained, not inferred from prose.
No same-family internal agent is substituted. All review processes exited 0.

| Checkpoint | Grok | DeepSeek |
| --- | --- | --- |
| Design | design-grok.md: APPROVE | design-deepseek.md: APPROVE |
| #465 web | web-grok.md: APPROVE | web-deepseek.md: APPROVE |
| #466 terminal corrections | corrected-terminal-grok.md: APPROVE_WITH_NITS | corrected-terminal-deepseek.md: APPROVE_WITH_NITS; new P2 notification subsequently fixed |
| #466 return UI | corrected-return-ui-grok.md: APPROVE_WITH_NITS | corrected-return-ui-deepseek.md: APPROVE_WITH_NITS |
| #467 materials | corrected-materials-grok.md: APPROVE_WITH_NITS | corrected-materials-deepseek.md: APPROVE_WITH_NITS |
| Final handler/type correction | final-delta-grok.md: APPROVE | final-delta-deepseek.md: APPROVE |

[Dispositions and regression cases](dispositions.md) retain fixes, refuted
conditional findings and ownership of nonblocking polish under #464.
No P0/P1/MAJOR remains unclosed. Earlier review approval did not waive later
code changes or the production build failure; both were rechecked before PR.

## Observable scope and limitations

- Source-derived unified diff files/line numbers persist in current Chat and
  are readable without an external Agent. Unsupported/incomplete syntax fails;
  website completeness and host comparison semantics remain unverified.
- Single owned PTY uses login shell; user-confirmed structured report persists
  to original task, survives notification loss and dedups retries. No ANSI or
  exit-code report inference, no automatic Agent startup.
- Requirement/task/test citations and fixed draft revisions supplement both
  material kinds. Stale/different SHA/missing coverage remain explicit gaps.
- Producer fixtures and isolated UI tests are synthetic integration evidence.
  Actual enterprise platform and Agent pilots plus both launch scenarios remain
  #450/#452/#454/#455/#457. This is not a 0.7.0 release or app replacement.

## Merge rule

MACHINE PASS + both actual independent judge lanes APPROVE* permits this T3
implementation to proceed to PR. Merge still requires green latest-head CI;
GitHub PR records the exact commit and CI run. Do not close pilot/release gates.
