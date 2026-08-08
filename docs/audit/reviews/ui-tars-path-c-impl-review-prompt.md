# Dual/Pi review: UI-TARS Path C implementation (post-fix)

## Context

Path multipath selected **Path C** (pattern absorption). First Pi path review (ui-tars-path-c-pi-20260808-233126) **confirmed path selection** but **REJECT** on:

1. start_box four-number comma form parsed as corner not center (test red)
2. `parseGuiClickPoint` unwired dead code
3. Missing S4/S5 (playbook + docs) at that snapshot

## Fixes since then (verify in current tree)

- `gui-action-parse.ts`: comma **and** space box separators → center
- `qwen-vl-worker.py`: matching parse
- `qwen-vl-locator.ts`: recover/prefer parse from raw (wired)
- `locate-chain` + `executor`: experimentalRaw → Thought caption via `formatExperimentalSuggestionCaption` + `sanitizeComputerCaption`
- `llm/adapter.ts` rule 12b playbook
- user guide §6.2/6.3 + architecture §9.4
- unit tests green for parse/thought/locator

## Review focus

1. Security: experimental still G4 force-interactive? no L2 bypass?
2. Caption spoof resistance
3. No 0–1000 rescale regression
4. Tests adequate?
5. Docs honest (not claiming UI-TARS model parity)?

## Verdict

Final line EXACTLY one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
