## Batch: voice-pack-windows-closeout
## Scope
Closeout after multi-adversarial review of Windows SEA packaging + whisper auto-download + WS fail-closed + STT harden.

Base already on main: fa0e69c..f6291ba
This branch adds: launch.bat fail-closed, README whisper honesty, skill.import-* validators, large-v3-turbo UX honesty, whisper env inherit.

## DoD
1. launch.bat exits non-zero when port 23401 not listening
2. skill.import-folder/path/files valid under production WS strict
3. large model honesty visible
4. No unattended/trust default regression
5. Tests for WS core types still pass

## Prior adversary synthesis
See docs/audit/reviews/voice-pack-windows-closeout-adversary-20260809.md

## Ask
Independent re-review. End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
