## Dual review: UI-TARS Path C implementation (post-fix)

### Summary

All **blocking issues** from the first Pi review (`ui-tars-path-c-pi-20260808-233126`) are **resolved**:

1. ✅ **Comma-separated box form now parses as center** — `gui-action-parse.ts:87-97` regex `s*[, ]\s*` matches both separators; box center computed as `(a+c)/2, (b+d)/2`. Test `parseGuiClickPoint: start_box four numbers → center` passes.

2. ✅ **`parseGuiClickPoint` is wired** — Imported in `qwen-vl-locator.ts:5` and called at lines 91 (fallback) and 95-99 (prefer box-center). Python worker `_parse_point` has matching implementation (lines 59-71).

3. ✅ **S4 (playbook) delivered** — `llm/adapter.ts:378-385` adds rule 12b `computerUsePlaybook` with observe→act→observe discipline.

4. ✅ **S5 (docs) delivered** — Architecture §9.4 (Operator mapping table) and user guide §6.2/6.3 (comparison table + action space quick reference) added.

### Security verification (ADR-020 checklist)

| Check | Status |
|-------|--------|
| **G4 force-interactive intact** | ✅ `executor.ts:1129-1139` still calls `await reL2(...)` with `["computer.experimental_suggestion"]` — experimental suggestions MUST be human-approved. No auto-inject. |
| **Caption spoof resistance** | ✅ Three-layer defense: `sanitizeComputerCaption` strips control/Zl/Zp/Cf chars; `experimentalRaw` sliced to 500 chars (`locate-chain.ts:638`); thought capped at 160 chars with prefix "模型思考：" |
| **No 0–1000 rescale regression** | ✅ `normalizeQwenVlPoint` (clamp-only) and `_normalize` (clamp-only) preserved; no smart_resize ported |
| **Trust monotonicity** | ✅ Path C only enriches human context at the experimental gate; never weakens L2/hard-deny/dual-switch |
| **originWs** | N/A — no new confirm dialects |

### Tests

All 16 tests pass (previously 12/13):
- Box center (comma and space forms)
- Thought extraction with truncation
- Caption spoof sanitization
- Out-of-bounds clamping
- Prose false-positive avoidance

### Docs honesty

Docs correctly frame Path C as **"pattern absorption"** not model parity:
- §6.2 table: "CMspark **吸收其纪律与解析经验**，但 **产品身份不同**"
- §9.4 table: Action DSL + Thought → "实验层 raw → Thought **仅用于** re-L2 文案"

### ADR-020 capability declaration (from decision doc)

```
Surface:      L2 Computer Use experimental locate only (no new tool surface)
L2-classes:   experimental re-L2 caption enrichment only (still force-interactive)
Compose:      none (no Pack/MCP change)
Autonomy:     single (no worker host_computer change)
Trust:        monotonic — more human context on experimental gate; never auto-inject
Channel:      community
```

Verified accurate — no new Surface/Compose/Autonomy dimensions; trust monotonically increases (more context, same gates).

### Non-blocking nits

- None. All previous nits addressed (playbook added, docs added, last-resort heuristic tightened to require click/point/box context).

VERDICT: APPROVE
