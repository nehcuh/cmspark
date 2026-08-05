## Review Findings

I've analyzed the design document against the codebase (pack-engine.ts, validator.ts, types.ts, PacksPanel.tsx, suggest-scene.ts) and ADR-020 requirements.

### Non-blocking Nits

**Nit 1: Missing `tools` field in `UserPackSaveInput` type (types.ts:97-110)**
- The design §5.1 specifies `tools?: { mode, allow, deny }` for user pack save input
- Current type lacks this field; `saveUserPack` hardcodes `mode: "unchanged"` (pack-engine.ts:392-396)
- **Fix**: Add the field to `UserPackSaveInput` and extend `saveUserPack` to handle it

**Nit 2: Clone tool preservation not implemented (PacksPanel.tsx:153-165)**
- Design §D6 requires: "另存：「保留原场景工具限制」默认关；开启则复制 tools（+ requires/channel 字段）"
- Current `clone` mode only copies skills/MCP/prompt, ignores tools entirely
- **Fix**: Add UI checkbox and tool config copy logic

**Nit 3: MCP+whitelist orthogonality needs implementation decision (adapter.ts:490-494)**
- Current code filters ALL tools (native + `mcp__*__*`) against `tool_whitelist`
- If user sets allowlist to `["list_tabs"]` only, all MCP tools get filtered out even when MCP servers are selected
- Design §D8 correctly calls this out as "MCP 与 native 白名单正交"
- **Fix approach**: Either (a) auto-include `mcp__<server>__*` patterns in whitelist when MCP servers selected, or (b) change adapter to filter native tools by whitelist and MCP tools separately by `active_mcp_server_ids`

**Nit 4: Design §D6 should clarify "整组保留" scope**
- States "保留 tools 时必须整组保留 mode+allow+deny+requires_modules+channel"
- Implementation should validate requires_modules match the tools being copied
- UI should warn if cloning from community/enterprise pack with netsec tools

---

### Security Assessment (Sound ✓)

1. **Trust bypass prevention**: Pack cannot write `auto_approve_dangerous` or other trust keys (FORBIDDEN_PACK_KEYS in types.ts:161-172 blocks this; validator.ts:57-68 enforces it)

2. **Allowlist expansion risk correctly identified**: Design §1.1 acknowledges `allowlist` mode can expand surface relative to current thread; UI must warn (D3)

3. **requires_modules gating works**: `computeApplyBlocked` (pack-engine.ts:477-489) already validates modules before apply; D5's "allow 含 shell_exec → requires_modules 含 shell" is sound

4. **L2 confirmation unchanged**: No design change to L2 forceConfirm for shell/netsec/evaluate

5. **Community channel declares enterprise tools is OK**: Design §1.1 says "community 用户场景可声明 enterprise 工具，apply 仍 enterprise 门" — this is correct; `computeApplyBlocked` gates on channel + profile

---

### ADR-020 Compliance ✓

Capability declaration is accurate:
- **Surface**: n/a (reuses existing shell/netsec/host/evaluate)
- **Compose**: pack | skill | mcp-server
- **Autonomy**: single
- **Trust**: module + profile + L2 unchanged; Pack forbids auto_approve
- **Channel**: community user packs may declare enterprise tools, apply still gated

No new "中层 Agent" runtime; Pack stays composition-only per ADR-020 §B2.

---

### Product Completeness (G1-G4) ✓

All gaps addressed:
- G1 (builtin read-only): Design D1 preserves this correctly
- G2 (user scenes tools.mode fixed): Design D2 adds allowlist mode
- G3 (另存为 lose allowlist): Design D6 adds preserve checkbox
- G4 (creation experience): Design §J1/J2/J3 covers three entry points; AI三分法 (recommend/generate/optimize) maps to suggest-scene.ts modes

---

### Feasibility ✓

Engine already has all primitives:
- `computeWhitelist`: handles mode/allow/deny (pack-engine.ts:45-58)
- `validator`: checks tool names and forbidden keys (validator.ts:171-188)
- `computeApplyBlocked`: gates on modules/profile (pack-engine.ts:477-489)
- `applyPack`: writes thread fields (pack-engine.ts:675-788)

Implementation sequence (§6) is sound; MCP orthogonal fix correctly prioritized as #0.

---

VERDICT: APPROVE_WITH_NITS
