# Outbound MCP Server — Phase 0 Spike Plan

| Field | Value |
|-------|--------|
| Date | 2026-08-03 |
| Status | **P0b LOCKED** for S40 AFK · implements brief L1–L9 |
| Decision SoT | **[ADR-022](../../adr/022-outbound-mcp-server.md)** |
| Process brief | [cmspark-as-mcp-server-brief-2026-08-03.md](../../decisions/cmspark-as-mcp-server-brief-2026-08-03.md) (superseded as SoT) |
| Code | `companion/src/outbound-mcp/` (stdio façade skeleton) |

## 1. Goal (Phase 0)

Prove whether CMspark's **logged-in Chrome session** is irreplaceable vs Playwright MCP on SSO tasks **before** expanding product surface.

Phase 0 is **not** a ship of "Browser MCP clone".

## 2. Tool whitelist (default outbound profile)

| # | Tool | Why |
|---|------|-----|
| 1 | `cmspark__list_tabs` | Orientation without DOM dump |
| 2 | `cmspark__navigate` | L1 navigate (confirm when domain policy requires) |
| 3 | `cmspark__get_page_text` | **Data-exfil class** — disclosure gate (L3+) |
| 4 | `cmspark__click` | Interactive L1 |
| 5 | `cmspark__type` | Interactive L1 |
| 6 | `cmspark__screenshot` | **Data-exfil class** — disclosure gate (L3+) |
| 7 | `cmspark__wait_for` | Stability |
| 8 | `cmspark__downloads_find` | Read-only Downloads (no path escape) |

### Forbidden (hard)

cookies*, evaluate, host_*, shell_*, netsec_*, osascript_*, skill_install (internal), MCP meta passthrough.

## 3. Metrics sheet (T1 primary)

| Metric | Threshold |
|--------|-----------|
| Task completion rate | ≥ 80% in time box |
| Confirm timeouts | Actionable MCP error, no hang |
| Profile violations | **0** forbidden tools |
| Audit completeness | 100% tool calls leave audit line |
| Confirm without Side Panel | Document only if tray path exists; else fail-closed |

## 4. Disclosure copy (L3+)

> 此 MCP 调用将把页面文本/截图发送给**外部**编程 Agent 使用的云端模型。  
> 仅在你已确认该任务与数据分类允许时继续。

## 5. Spike code DoD (P0c)

> **Eval gates (authoritative for next impl):** [2026-08-04-outbound-mcp-p0c-eval-gates.md](2026-08-04-outbound-mcp-p0c-eval-gates.md) M1–M9 · skill [eval-engineering-gate](../../skills/eval-engineering-gate/SKILL.md)

- [x] stdio entry skeleton lists only whitelist names  
- [x] refuses forbidden tools with structured error  
- [x] audit line helper  
- [x] Server-side disclosure session (not caller-trusted bool) — M3  
- [x] synthetic origin on invoke (`outbound_mcp:<caller>`) — M6  
- [x] CLI `cmspark-agent mcp-outbound` (not default-on) — M7  
- [x] Injectable dispatcher bridge + unit tests  
- [x] Production: loopback HTTP invoke + createToolExecutor(Extension WS)  
- [x] stdio mcp-outbound defaults to HTTP dispatcher (Bearer ws_secret)  
- [ ] Tray/global confirm (L8) — required before interactive T1  
- [ ] 独立对抗 → Pi 复审（确认序）  
- [ ] P0d bake-off — 完整手测清单见 **[2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md](2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md)**

## 6. Bake-off (P0d) — human checklist

> **权威步骤与记分表**：[`2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md`](2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md)

1. Start Companion + Extension logged into SSO site  
2. Run Playwright MCP on same task (clean profile)  
3. Run CMspark outbound on same task（disclosure → list_tabs → navigate → get_page_text）  
4. Fill metrics table; if T1 fails L7 → pivot Option B/C  

**AFK note**: live SSO bake-off is human-session only; protocol + P0c bridge complete on main.

## 7. Non-goals

Full catalog, L2 export, CWS, default-on install, Skill-only browser service.
