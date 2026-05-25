# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-05-24 18:04

CMspark Browser Agent MVP implemented. 30 design decisions documented, full codebase created (extension: Plasmo+React, 16 files; companion: Node.js+TS, 11 files; 3 builtin skills; 23 tool definitions).

**Key decisions**:
- Extension ↔ WebSocket ↔ Companion topology
- Side Panel as primary UI, popup for status
- Default DeepSeek v4-pro with DEEPSEEK_API_KEY env var
- Thread-based conversations with tab targeting
- Type A skills (Markdown+YAML frontmatter, compatible with VibeSOP)
- Browse skill auto-activated for every new thread
- Async tool execution via Promise bridge

**Build status**:
- Extension: `plasmo build` passes, output `build/chrome-mv3-prod/`
- Companion: `tsc` passes, `cmspark-agent start` runs
- Load extension from: `chrome-extension/build/chrome-mv3-prod/`
- Start companion from: `companion/` via `npm start`

**Critical fixes applied**:
- Messages: use `chrome.runtime.onMessage` (not Port) in Side Panel
- Companion must be built from `companion/` directory (not `chrome-extension/` which has `noEmit: true`)
- config.json may need deletion if corrupted (`rm ~/.cmspark-agent/config.json`)
- Old companion process must be killed before restart (`pkill -f "dist/index.js"`)

**Next steps**:
- Continue integration testing (Twitter bookmarks extraction)
- Tune agent behavior for reliable multi-step operations
- Implement remaining T11.3 integration tests
<!-- handoff:end -->
