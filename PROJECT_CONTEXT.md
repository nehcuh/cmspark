# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-05-26 — Goal Realignment & Core Reliability Loop Closure

Aligned `docs/GOAL.md` with the actual near-term objective: stabilize a safe, testable browser-agent MVP before pursuing SSO automation, Type B/C Skills, replay, and daemon mode. Added a minimal companion regression test harness and closed several review-identified reliability gaps.

**Key decisions**:
- **Goal scope**: Reframed current delivery as “安全稳定化 MVP”; moved automatic SSO reuse and larger automation platform capabilities to post-stabilization goals.
- **Regression harness**: Added `npm --prefix companion test` using TypeScript + Node `node:test`, with coverage for trusted domains, high-risk JS detection, thread metadata updates, and tool-result message shape.
- **Thread state loop**: Added `thread.update` in companion and background, synchronized Side Panel Pin Tab changes into `pinned_tabs`, and fixed adapter fallback to use the current thread’s pinned tab.
- **Tool result persistence**: Standardized and persisted `role: "tool"` messages with tool-call linkage so future LLM turns and skill-craft can recover actual tool results.
- **Execution safety**: Added pre-execution blocking for dangerous `evaluate` / `osascript_eval` code paths until a user-confirmation queue exists.
- **Trusted domains UI**: Added Cookie trusted domain editing in Settings and normalized full/flat config updates so `trusted_domains` and LLM settings stay in sync.

**Validation**:
- `npm --prefix companion test` passes.
- `npm --prefix companion run build` passes.
- `npm --prefix chrome-extension run build` passes with the existing `svgo` optional warning.

**Next steps**:
- Add Side Panel tests or reducer-level tests for thread metadata state.
- Decide whether tracked `chrome-extension/tsconfig.tsbuildinfo` should stay in version control or be removed from Git tracking.

### 2026-05-26 — P0/P1/P2 Security & Stability Hardening

Successfully diagnosed, resolved, and compiled major architectural, security, and stability defects across the extension and companion. 5 files modified: `server.ts`, `security.ts`, `skill-engine.ts`, `adapter.ts`, `BottomBar.tsx`, and `browser-bridge.ts`.

**Key decisions**:
- **P0 Security Hardening**: Built a pre-flight Cookie gate in companion `server.ts` preventing un-受信 domains from leaking browser session cookies. Integrated `path.resolve` boundary check in `skill-engine.ts` blocking zip/folder path traversal vulnerabilities during Skill imports.
- **P1 Core Stability**: Switched on real-time tab querying in `BottomBar.tsx` (Tabs Panel) to restore Pin / Tab Binding functionality. Embedded `chrome.debugger.onDetach` listener in `BrowserBridge` to purge stale tab cache. Rewrote context Compaction in `adapter.ts` to group assistant `tool_calls` and `tool` results together, preventing OpenAI schema validation crashes (HTTP 400).
- **P2 Tooling Polish**: Reinforced `click` CDP with smooth hover/move pre-click sequence and strict failure catch. Implemented native file uploading in `uploadFile` using CDP `DOM.getDocument` and `DOM.querySelector` to resolve target `nodeId` dynamically. Repaired bitmask states (`buttons: 1`) during CDP drag movements.

**Next steps**:
- Perform end-to-end integration QA over the multi-threading tab PIN/isolation feature.
- Expand G10/G11 (Type B & C Skills) to implement complex automated chains and parallel sub-agent routing.

### 2026-05-26 — Skill System Enhancement

Implemented slash command popover + skill-craft extraction + path-based folder import + configurable send shortcut. 13 files changed: 2 new components (SlashCommandPopover, SkillCraftPanel), 1 new companion module (skill-craft.ts), plus modifications to App, BottomBar, Settings, store, types, hooks, background, message-router, skill-engine.

**Key decisions**:
- Path-based folder import (user types filesystem path → companion reads directly) instead of `webkitdirectory` — the latter's "Open" button is greyed out in Chrome side panel context (3 implementation attempts all failed)
- Skill-craft: LLM analyzes conversation to extract reusable skill patterns; user previews and edits before saving
- Slash popover: `position: absolute` within `position: relative` input area (not fixed, which has issues in side panel)
- Send shortcut persisted via `chrome.storage.local`

**Next steps**:
- Test all 3 fixes together (slash popover, folder import via path, send shortcut)
- User may need to reload extension + re-open side panel to pick up background changes

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
