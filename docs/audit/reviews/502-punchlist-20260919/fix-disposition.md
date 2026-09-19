# 502 punchlist X1–X10 修复处置

HEAD after fix: this commit on `fix/502-adversarial-punchlist`.

| ID | Severity | Fix |
|----|----------|-----|
| X1 | BLOCK | `liveToolsFrontierIndex` — last tools block is live even with trailing assistant |
| X2 | BLOCK | archive stub `omission:"archive"` → 「正文未保存」; SEC-C keeps 「出于安全未持久化」 |
| X3 | MAJOR | spawn_worker L2 preview + HMAC bind truncated `goal` / `role_prompt` |
| X4 | BLOCK | `installKickAbortController` + `signal` on kick `chatCreate`; `cancelDeferredLlmKick` on abort (N-1) |
| X5 | MAJOR | `fleetStripShouldPoll` — idle fleet does not 4s-refresh `snapshot.at` |
| X6 | MAJOR | archive toggle sends `config.set` immediately |
| X7 | MAJOR | `shouldShowRoundLimitHint(..., loopSuggestVisible)` hides unarmed hint when arm card is up |
| X8 | MAJOR | `quarantinePersistedToolRow` rewrites live mirror; rebuild skips live if disk quarantined |
| X9 | BLOCK | spawn fixtures include `goal`; BOARD_MISSING test matches #514 soft-skip |
| X10 | MAJOR | `config.set` allowlist `embedded_terminal.enabled` |

Also: missing kick → `SPAWN_KICK_FAILED` rollback; settings copy discloses history.db/logs; fleet card footer wraps; LoopStatusRow confirm count is thread-scoped.

**Machine [executed]:** companion targeted 93 + 92 pass; extension punchlist files 58 + 89 pass.

Dual: kimi REJECT + claude REJECT on pre-fix HEAD; this commit is the absorb.
