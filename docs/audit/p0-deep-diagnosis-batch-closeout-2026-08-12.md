# P0 Deep Diagnosis Batch Closeout — 2026-08-12

**Branch:** `fix/p0-deep-diagnosis-batch`  
**Base:** main `c24c677` (#172 P1 MERGED)  
**Source:** fanout P0 action plan

## Status

| # | Item | Status |
|---|------|--------|
| SEC-01 | host_*/osascript require security_token | **Done** |
| SEC-02 | MCP stdio minimal env | **Done** (`buildMcpStdioEnv`) |
| SEC-03 | system_prompt append-only + security footer | **Done** |
| ISO-01 | worker_cancel / collect_handback ownership | **Done** |
| CORR-01 | chat.create sync slot claim before await | **Done** |
| CORR-05 | regenerate abort before truncate | **Done** |
| CORR-02 | WS close abort panel LLM loops | **Done** |
| OPS-01 | assert_file_exists + SEA extension fail-closed | **Done** |

## Tests
- package gates: **72 pass**
- companion: **2703 pass** (+P0 unit tests); **14 fail** pre-existing computer-executor/uia-watch
- extension: **622 pass**

## Notes
- board_claim already host-scoped; ownership tightened on cancel/handback
- MCP servers needing secrets must set `config.env` explicitly (no longer inherit user_env)
