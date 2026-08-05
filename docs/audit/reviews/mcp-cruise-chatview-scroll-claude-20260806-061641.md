## Code Review Findings

### MCP Gate Algebra (A) — ✅ Correct

**Three-flag waive verified** (`companion/src/server.ts:4686-4690`, `5042-5045`):
```typescript
const userFullAutonomyCruise =
  securityConfigEarly?.auto_approve_dangerous === true &&
  securityConfigEarly?.auto_approve_enterprise_tools === true &&
  securityConfigEarly?.allow_all_schemes === true
```
- ✅ All three flags required (AND logic)
- ✅ Applied consistently in both `executeMcpTool` and `executeMcpMetaTool`
- ✅ Audit logs `mcp.confirm.waived` / `mcp.meta.confirm.waived` with `reason: "full_autonomy_cruise"`

**Partial flags still confirm** — Verified by tests:
- ✅ "god-mode ON + critical MCP → STILL confirms" (two flags: `auto_approve_dangerous + allow_all_schemes`)
- ✅ "enterprise auto-approve alone + critical MCP write → STILL confirms" (single flag)
- ✅ "full-autonomy cruise (三旗) + critical MCP write_file → NO confirm" (three flags)

**originWs preserved** — Verified at lines 4745 and 5080:
```typescript
{ originWs: ws }
```

**Tests pass**: All 39 tests in `mcp-capability-gate.test.ts` pass.

### ChatView Scroll (B) — ✅ Correct

**Pin behavior** (`ChatView.tsx:154-163`):
- ✅ `pinnedRef.current` tracks whether to auto-scroll
- ✅ `ignoreScrollRef` prevents false unpin from programmatic scrolls (lines 89-103)
- ✅ Threshold 120px (line 162) — looser than previous 60px

**stickKey fingerprint** (`ChatView.tsx:178-193`):
- ✅ Captures more than `messages.length` — includes last message content length, tool_call result lengths, streaming state
- ✅ Addresses full reload and late layout growth issues

**ResizeObserver** (`ChatView.tsx:220-232`):
- ✅ Catches content height growth (mermaid, tool results, KaTeX)
- ✅ Only scrolls when `pinnedRef.current` is true

**Thread switch re-pin** (`ChatView.tsx:242-250`):
- ✅ Sets `pinnedRef.current = true` on thread switch
- ✅ Clears refs to force scroll

**overflow-anchor CSS** (`ChatView.tsx:1310-1323`):
- ✅ Sentinel element with `overflowAnchor: auto`

### Security / Product — ✅ Correct

- ✅ Trust monotonicity: Cruise is explicit max risk (tested)
- ✅ Partial flags do NOT silently weaken MCP (tested)
- ✅ No new confirmation dialect
- ✅ `skill_refs` in `netsec-port-survey/pack.yaml` is user-local pack edit — not part of security scope

### Nits (non-blocking)

1. **ChatView nit**: When `pinnedRef.current` is false, the auto-scroll effect still updates refs (`lastStickKeyRef`, `lastMessageCountRef`) before early returning. This is harmless but slightly unnecessary — the refs would be updated anyway when the user scrolls back down and `pinnedRef` becomes true.

2. **Threshold change**: Scroll threshold changed from 60px to 120px (`ChatView.tsx:162`). This is reasonable for long threads with larger fonts, but worth noting.

3. **Unused bottomRef**: The `bottomRef` is declared and rendered as a sentinel, but the doc comment says "Sentinel for layout end; keeps stick-to-bottom measurable" while the actual mechanism uses `contentRef` with ResizeObserver. The sentinel is only for CSS `overflow-anchor: auto`. The ref itself is unused.

4. **pack.yaml drive-by**: The `skill_refs` change in `netsec-port-survey/pack.yaml` is outside the stated A/B scope but appears to be a user-local pack customization (引用用户技能库已安装的全局技能). No security coupling found.

---

VERDICT: APPROVE_WITH_NITS
