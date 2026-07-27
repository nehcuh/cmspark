Now I have the brief and sufficient context. Here's my review.

---

# Review: Scenario Packs + Mini Terminal (libghostty)

**Date**: 2026-07-26  
**Reviewer**: Claude (adversarial posture)  
**Brief**: `docs/decisions/v1.3/scenario-packs-libghostty-brief-20260726-190422.md`  
**Context read**: GOAL.md, architecture.md, computer-use-design-brief.md, ui-three-mode-redesign-brief, mcp.md, DESIGN.md

---

## 1. Strategic Fit: Deepen or Distract?

**Distract, with one narrow exception.**

CMspark's stated positioning in the brief itself: "**browser-native agent, not IDE, not pen-test platform**." Three of four pillars under review are DevSec/NetSec/custom-terminal — none deepen the browser-agent value prop. They pivot the product toward a SAST/nmap-lite/terminal-emulator direction that:

- **Duplicates mature, well-funded incumbents.** Snyk/Semgrep/GitHub Advanced Security own SAST. Burp Suite/Caido/OWASP ZAP own web-security testing. Ghostty/iTerm2/Warp own terminal emulation. CMspark would enter all three markets simultaneously with a Chrome Side Panel — a distribution and UX mismatch.
- **Confuses the L0/L1/L2 mode model shipped 2026-07-26.** The three-mode redesign invests heavily in `chat → browser agent → computer use` as a progressive-escalation story. DevSec/NetSec are orthogonal capability dimensions that don't fit any of the three levels. They'd require a 4th mode ("security auditor") or overload L1/L2 with unrelated tool vocabularies.
- **The one narrow exception**: "Scenario Packs" as a **packaging concept** — pre-bundled skill + knowledge + MCP config + tool_whitelist + thread preset — is genuinely useful and maps cleanly onto existing primitives. But it's a distribution/UX feature, not a new product pillar. More below in Q5.

**Verdict**: Kill DevSec and NetSec as product pillars. Keep Scenario Packs as a packaging layer. Mini Terminal needs major scoping (Q3).

---

## 2. Rank Pillars: Ship Order or Kill

| Rank | Pillar | Verdict | Reasoning |
|------|--------|---------|-----------|
| **1** | **Scenario Packs (packaging layer)** | **SHIP** — but stripped to packaging, not new runtime | Existing skill+knowledge+MCP+whitelist+thread-preset composition already works. A `scenario.json` manifest that bundles these + a one-click "Install Scenario" flow is ~2 days of work and delivers real user value. Do NOT build a "scenario runtime engine." |
| **2** | **Mini Terminal (xterm.js, not libghostty)** | **WAIT** — scope to Cockpit-only, xterm.js, L2 dev-tool, NOT user-facing shell | Terminal-as-dev-tool has merit for L2/Cockpit power users debugging MCP servers or inspecting companion logs. But it's an L2 tool, not a product pillar. See Q3. |
| **3** | **Dev Security Assistant** | **KILL** as product pillar; **salvage one skill** | A `threat-model` skill that prompts the LLM to STRIDE-analyze a PRD attachment is ~50 lines of YAML+markdown and fits the Type-A skill model perfectly. The full "white-box knowledge packs + Qwen audit + code branch linking" proposal is a 6-month SAST platform build. |
| **4** | **Network Security Assistant** | **KILL** entirely | CWS policy risk + legal liability + low overlap with browser-agent value prop. The brief's own research warns: "nmap/masscan-class tools: install/signing/sandbox friction on macOS + CWS dual-use/offensive tooling policy risk + legal liability if misused against third parties." This alone should be dispositive. |

---

## 3. libghostty Specifically: Build / Wait / Substitute / Never

**Substitute (xterm.js), Cockpit-only, L2 dev-tool scope. Never in Side Panel.**

The brief itself lays out the fatal path for libghostty in-extension:

> *"Chrome MV3 extension cannot link native libghostty; Companion can host node-pty and stream to ghostty-web/xterm in Cockpit"*
>
> *"WASM officially planned, not primary extension path today"*

This means the **only viable architecture** is Companion-hosted PTY → WebSocket → extension UI. In that architecture, **libghostty offers zero advantage over xterm.js**. Both are WASM/JS terminal frontends consuming the same PTY stream from Companion. libghostty's value (native GPU rendering, low latency) disappears when the PTY is already remote over WebSocket.

**Critical distinction the proposal conflates**: "terminal emulator UI" vs "arbitrary shell capability." A terminal widget that connects to a real shell on the Companion host is a **privilege-escalation vector** that bypasses the entire security stack (risk-engine, privilege-manager, confirmation queue, tool_whitelist). If the user can type arbitrary shell commands in a terminal, the `evaluate`/`osascript_eval` confirmation gates are meaningless.

**Recommendation**:

| Decision | What |
|----------|------|
| **libghostty** | **WAIT** — reassess when WASM is primary path and the GPU-rendering difference is measurable in-browser. Not before 2027. |
| **xterm.js** | **SUBSTITUTE** — use `xterm.js` + `node-pty` in Companion, WebSocket stream to Cockpit. Proven: coder/ghostty-web itself ships xterm.js-compatible API. |
| **Scope** | **Cockpit-only, L2 dev-tool**. Expose as a Cockpit panel (like Browser DevTools have a Console tab) for: MCP server debugging, `npm`/`uv` ad-hoc ops, companion log tailing. **Not** a user-facing "mini terminal" product pillar. |
| **Security** | **Whitelist-only command set** in v1. The terminal is a supervised input, not a free shell. Companion-side command filter before `node-pty` execution. Confirmation queue for commands outside whitelist. |
| **Never** | Side Panel terminal (320px is unusable for a terminal; it would be a toy that invites CWS rejection). Never free-shell. Never marketed as "terminal." |

---

## 4. Security & Store Policy: Red Lines for Network Tooling

| Red Line | Rationale |
|----------|-----------|
| **No port scanning** | nmap/masscan-class tools in a browser extension = Chrome Web Store **rejection with prejudice**. CWS Program Policies § "Unwanted Software" and "Dual-Use" explicitly cover network reconnaissance. Even if the scanner runs in Companion (not extension), the extension is the UI surface and would be treated as the distributed product. |
| **No third-party target scanning** | Scanning `localhost` or user's own infrastructure is technically defensible but practically indistinguishable from scanning third parties. CWS review won't parse the distinction. |
| **No bundled offensive tooling** | Even "defensive" tools like `sqlmap`, `nikto`, `hydra` bundled via MCP would make CMspark categorically a "security testing tool" per CWS classification, triggering enhanced review, slower approvals, and potential removal. |
| **Page source audit: already possible** | `get_page_html` + `evaluate` already give the agent full access to page DOM/source. A `security-audit` skill prompting the LLM to look for XSS sinks, missing CSP headers, exposed secrets — this is **safe, useful, and within existing capabilities**. No new tools needed. |
| **IP/URL analysis: MCP, not native** | VirusTotal/AbuseIPDB/Shodan lookups are fine as **MCP integrations** (user brings their own API key). CMspark must never bundle or proxy these. |

**One narrow safe path for a "Security" dimension**: a single Type-A skill — `security-page-audit` — that uses existing `get_page_html`/`evaluate` tools and prompts the LLM to produce a structured findings report. This is "browser agent looking at a page," not "pen-test platform." No new tools, no port scanning, no network tooling.

---

## 5. Minimal P0 That Delivers 80% User Value

The brief itself hints at this: *"existing composition surface: skill + knowledge + MCP + tool_whitelist + thread config — 'scenario pack' may be mostly packaging, not new runtime."*

**P0 (2–3 days)**: **Scenario Pack packaging layer**

```
scenario.json manifest:
{
  "name": "PRD Threat Model",
  "description": "STRIDE-analyze a PRD attachment",
  "version": "1.0.0",
  "skills": ["threat-model"],
  "knowledge": { "sites": [], "files": [] },
  "mcp": { "servers": [] },
  "tool_whitelist": ["get_page_text", "get_page_html", "read", "write"],
  "thread_preset": {
    "system_prompt_append": "You are a security architect...",
    "model": "claude-sonnet-4-20250514",
    "temperature": 0.3
  }
}
```

One-click "Install Scenario" from Side Panel → populates thread with skills, knowledge, MCP, whitelist, preset. No new runtime code. The scenario manifest is JSON validated at install time; all referenced assets must exist locally or be fetchable.

**That's it.** This delivers:
- Team sharing ("here's my PRD review scenario, install it")
- Use-case templates ("Code Review scenario," "Writing scenario," "Research scenario")
- A discoverable surface for the existing composition primitives

The DevSec/NetSec/terminal pillars **are not in P0**. They can be re-proposed as independent briefs with:
- User research evidence (not "users might want")
- Competitive analysis (why CMspark vs existing tools)
- Concrete scope (specific tools, not "bundle popular network security tools")
- CWS policy review (written opinion, not assumption)

---

## 6. Final Recommendation

# **APPROVE_WITH_CHANGES**

**Must-change bullets (7)**:

1. **Kill DevSec and NetSec as product pillars.** They distort the product into a SAST/pen-test platform. The brief's own positioning says "not IDE, not pen-test platform."

2. **Descope "Scenario Packs" to a packaging layer** — `scenario.json` manifest over existing primitives (skill + knowledge + MCP + whitelist + thread preset). No new runtime, no "scenario engine," no new security surface. 2–3 days to ship.

3. **kill `libghostty` for v1.** The WASM path is not primary per upstream; MV3 can't link native; the only viable arch (Companion PTY → WS → UI) makes libghostty vs xterm.js indistinguishable. Revisit when Ghostty WASM is GA.

4. **Substitute xterm.js, Cockpit-only, whitelist-gated commands.** Not a user-facing "mini terminal." A Cockpit dev-tool panel for MCP debugging and companion ops. Command whitelist enforced in Companion before `node-pty`.

5. **No port scanning, no offensive tooling, no bundled security binaries.** CWS dual-use policy is a hard red line. Page-source audit via existing `get_page_html`/`evaluate` + a `security-page-audit` Type-A skill is the only safe surface.

6. **Every "scenario" must fit the L0/L1/L2 mode model.** If a scenario can't cleanly map to `chat | browser agent | computer use`, it doesn't ship. Security scenarios that want keyboard-level control don't fit any existing mode — they're proposing a 4th mode by stealth.

7. **No user-shell exposure.** The proposal conflates "terminal emulator widget" with "arbitrary shell." A free shell in Cockpit bypasses the entire security stack (risk-engine, privilege-manager, confirmation queue). If the user can type `rm -rf ~/` in a terminal, `osascript_eval` confirmations are theater.

---

## 7. Confidence

**Confidence: 85%**

Deducted 15% because:
- I haven't reviewed CWS policy language exhaustively (the network-tooling risk is based on documented policy patterns, not a legal review)
- User demand for DevSec features inside a browser agent is unmeasured — there may be a niche I'm underestimating
- The "Scenario Packs as packaging" P0 assumes the existing composition primitives are solid; if skill/knowledge/MCP/whitelist have UX gaps, the pack UX inherits those gaps

---

*End of review. No code changes recommended — this is a product-level gate, not an implementation review.*
