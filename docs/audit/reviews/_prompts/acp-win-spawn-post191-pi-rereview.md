# Pi re-review — post-#191 Mode C residuals (after multi-lane adversarial)

You are **Pi**, performing the **second-stage re-review** required by the eval-engineering gate (confirm order locked 2026-08-04). You must read the **consensus report in full**, the live diff, and the cited source. Do not rubber-stamp the adversary, the implementer, or this prompt.

## Confirmation order (locked)

1. MACHINE green (unit tests) — already run this session; you may re-run
2. Independent multi-lane adversary + consensus (already run)
3. **You (Pi)** confirm or reject those conclusions against the **current working tree**

## Blast / capability

```text
Blast:        T3 (Windows spawn / cmd host / Mode C launch honesty)
Surface:      existing ACP stdio + Mode C local terminal (no new tool)
L2-classes:   (none added)
Compose:      acp + coding_handoff.open_local_terminal
Autonomy:     single
Trust:        pin System32 cmd/powershell; no new confirm; no shell:true; no grant skip
Channel:      community
```

## Inputs (must open with tools)

| Artifact | Path |
|----------|------|
| Consensus (adversary synthesis) | `docs/audit/reviews/acp-win-spawn-post191-consensus.md` |
| Prior #191 consensus (do not regress R1–R14) | `docs/audit/reviews/acp-win-spawn-consensus-20260816-090554.md` |
| Live code | `companion/src/acp/win-spawn.ts`, `open-local-terminal.ts`, `manager.ts` |
| Tests | `companion/tests/acp-win-spawn.test.ts`, `acp-open-local-terminal.test.ts` |
| Base | `750cf41` (current HEAD / origin/main after #191) |
| Diff | attached by `pi-external-review.sh` (`git diff` + staged). New consensus/prompt files are staged so they appear. |

## Machine (this session, parent re-ran after implement)

```text
./companion/node_modules/.bin/tsc -p companion/tsconfig.test.json --pretty false
  → exit 0

node --test companion/.test-dist/tests/acp-win-spawn.test.js \
             companion/.test-dist/tests/acp-open-local-terminal.test.js \
             companion/.test-dist/tests/acp-discover.test.js
  → exit 0
  → 83 pass / 0 fail / 3 skip (win32 live fixtures)
```

Do not treat “83 pass” as sufficient by itself. Check the locks below in source.

## What consensus locked (must-fix)

| ID | Lock |
|----|------|
| **F1** | `launchStart` uses wrapViaCmd contract: extra `"` around the `start` line + `windowsVerbatimArguments:true` on the **cmd host only**. Never verbatim on wt PE argv. |
| **F2** | Real PE `wt.exe`: exit 0 or still-running after observe window = CLI handoff success. Only spawn error / non-zero falls through to start. Not 80ms-without-error. Never spawn bare `wt.exe` / WindowsApps alias. |
| **F5** | Pin `System32\cmd.exe` and `System32\WindowsPowerShell\v1.0\powershell.exe`. No `ComSpec`, no bare `cmd.exe` / `powershell.exe`. Missing file → ENOENT, no PATH fallback. |
| **F7** | Success timeline uses actual `r.app` / `appLabel`, not config `terminalApp`. `pref=wt` + Console fallback must not say `wt · 交互`. |

Deferred on purpose (do not REJECT solely for these unless you find a new lie/exec hole): F3 Store PE scan, F4 `-NoProfile`, F6 60s unlink (do not reopen R6), settings dropdown platform filter.

## Your job

1. Read the consensus file **in full**. Then read live functions at file:line. Do not review from this summary.
2. For each of F1/F2/F5/F7: **agree / disagree** that the lock is actually in the tree, with evidence.
3. If consensus was **too soft** (missed a merge-blocking hole that is still in the tree) → **REJECT**.
4. If consensus was **too harsh** (nit filed as blocker) → you may keep APPROVE_WITH_NITS and say so.
5. Check no R1–R14 regression: `spawnAcpChild` still used at both stdio sites; no `shell:true`; `findWindowsTerminalExe` never returns bare `wt.exe` / WindowsApps alias; cmd-host Mode C stays L0; `wrapViaCmd` still strips prompt.
6. Three layers: Outcome (locks visible + tests exist), Trajectory (diff scoped to ACP Mode C, no drive-by), Component (file:line).
7. Do not award extra credit for longer prose, more citations, or looking like the consensus.

## Output

1. Table: F1/F2/F5/F7 + R1–R14 regression — agree/disagree + file:line
2. Any **new** blockers the adversary missed
3. Nits only (non-blocking)
4. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
