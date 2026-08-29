# Batch C lane — skeptic

**LANE:** skeptic  
**VERDICT:** PASS_WITH_CHANGES  
**HEAD:** e36176a5 · #247 strawman

Tried to kill C1/C3/C5/C2/C4. Findings are real. The five attacks do **not** refute the batch.

| ID | Skeptic attack | Disposition |
|----|----------------|-------------|
| C1 | exact match vs query | Keep; canonicalize keep-query / drop-hash |
| C2 | PYTHONPATH / `--require` | Keep; dedicated loader denylist; `--require` is argv |
| C3 | env prefix after parse | Keep; scan tokens when parse is null |
| C4 | same-user owns box | Keep; Darwin already said no |
| C5 | JSON order DoS | Keep; sort like netsec (order-DoS claim killed) |
