# CMspark Product Brief: Scenario Packs + Mini Terminal (libghostty)

**Date**: 2026-07-26  
**Ask**: Product-level review — recommend keep/kill/pivot for each pillar. Adversarial preferred. Chinese OK.

## Product today
CMspark = Chrome Side Panel AI agent + local Companion (Node/WS).
- Skills: markdown+YAML Type-A prompt templates; skill craft; semantic match
- Knowledge: domain/site docs + RAG chunking; import file/URL/directory
- MCP client with capability gates + confirmations
- High-risk: evaluate / osascript_eval force-confirm; domain whitelist; cookie trust
- UI modes L0 chat / L1 browser agent / L2 computer use (Cockpit)

Positioning: **browser-native agent**, not IDE, not pen-test platform.

## Proposal under review
1. **Dev security assistant**: threat-modeling + white-box knowledge packs; optional external code-audit assets (e.g. Qwen open audit prompts); threat-model web PRDs / attachments; link code branch from PRD; vuln fix advice + code review
2. **Network security assistant**: page source audit; common port scans; bundle popular network security tools; IP/URL analysis
3. **Open customization** for user scenarios
4. **libghostty mini terminal** in extension/web UI for precise/extensible ops

## Technical research facts (verified 2026-07)
- **libghostty**: official embeddable C/Zig terminal core from Ghostty; modular (libghostty-vt first); native GUI consumers; **WASM officially planned**, not primary extension path today
- **ghostty-web** (coder/ghostty-web): MIT, ~2.6k★, ~400KB WASM VT parser, **xterm.js-compatible API**; demo pairs UI with **real local shell over WebSocket** — UI alone is not a product
- Chrome MV3 extension **cannot** link native libghostty; Companion **can** host `node-pty` (or similar) and stream to ghostty-web/xterm in Cockpit
- Page HTML audit already possible via `get_page_html` / `evaluate`
- Bundling nmap/masscan-class tools: install/signing/sandbox friction on macOS + **Chrome Web Store dual-use / offensive tooling policy risk** + legal liability if misused against third parties
- Existing composition surface: skill + knowledge + MCP + tool_whitelist + thread config — "scenario pack" may be mostly packaging, not new runtime

## Questions for you
1. Strategic fit: does this deepen CMspark or distract into SAST/pen-test?
2. Rank pillars: DevSec / NetSec / Custom packs / Mini-terminal — ship order or kill
3. libghostty specifically: build / wait / substitute (xterm.js) / never in-extension
4. Security & store policy: red lines for network tooling
5. Minimal P0 that delivers 80% user value with existing primitives
6. Final recommendation: **APPROVE / APPROVE_WITH_CHANGES / REJECT** with 3–7 must-change bullets if not clean approve
7. Confidence 0–100%

Be concrete. Call out when proposal confuses "terminal emulator UI" with "arbitrary shell capability".
