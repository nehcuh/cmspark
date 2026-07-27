# UI/UX Depth Design Claims Brief — Adversarial Validation Target

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Purpose | Claims under adversarial + Claude/Pi dual review |
| Product surface | Chrome Side Panel (~320px) + Extension Cockpit |
| Prior IA | `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md` (approved) |
| Design tokens | `chrome-extension/src/sidepanel/ui/tokens.ts`, `docs/DESIGN.md` |

---

## Context (not claims)

CMspark is a dual-layer browser agent: Chrome Extension Side Panel ↔ WebSocket ↔ local Companion. Capabilities span chat (L0), browser tools (L1), and computer use (L2). Competitors referenced in prior analysis: Gemini in Chrome (native side panel), Claude in Chrome, Kimi WebBridge, Sider/Monica-style multi-tool sidebars.

---

## Claim set C1–C12 (to verify / refute / amend)

### Diagnosis claims

**C1. Root problem is IA + visual execution, not missing features.**  
Side Panel is a feature landfill (header icons, BottomBar multi-tabs, security modals, task bars) competing in one ~320px column; tokens exist but are inconsistently applied; old Material colors (`#4A90D9`, `#F44336`) still appear.

**C2. Gemini “beauty” = restraint + implicit context + single focus.**  
Not primarily brand purple/gradients; Material-like soft neutrals, conversation as protagonist, tools as outcomes not permanent nav.

**C3. Kimi WebBridge is architecture-overlap, not visual template.**  
WebBridge = local bridge + agent hands; UI is status/ops-first. CMspark should not default to bridge-console aesthetics.

**C4. Claude in Chrome is the best agent UX reference for depth-without-bloat.**  
Patterns: chat-first, `/` shortcuts, contextual suggestions, progressive power tools, clear agent tab ownership.

**C5. Sider/Monica are anti-patterns for CMspark default chrome.**  
Feature density → clutter; permanent multi-tool nav is what we must avoid.

### Product model claims

**C6. Three capability levels (L0/L1/L2) remain correct ontology.**  
Depth should escalate with mode + surface (Panel vs Cockpit), not with more permanent BottomBar tabs. Aligns with approved three-mode redesign.

**C7. Default Panel surface must be conversation-first (≥70% vertical for stream).**  
Header declutter (⋯ menu); BottomBar 0–2 contextual entries by mode; power features via `/` and settings.

**C8. Depth entry matrix is correct.**  
| Capability | Default visible? | Entry |
| Skills/Packs/Knowledge/MCP/Apps | No | `/` + settings |
| Current page context | L1 auto | Context chip |
| Tool execution | In-message cards | Not nav |
| Security confirm | Interruptive | Minimal strip + Cockpit full |
| Computer Use | Chip / escalate | Cockpit |

**C9. Visual direction should stay quiet-professional blue/neutral, not AI-purple.**  
Avoid Sider-like purple kits; keep/extend `#2563eb` + soft neutrals; L2/Cockpit may use dark HUD only.

### Execution claims

**C10. Ugly gap is mainly token inconsistency + chrome density + utilitarian chat/confirm chrome.**  
Fix order: P0 visual unify → P1 IA cut → P2 polish (tool cards, empty state, confirm three-layer) → P3 Cockpit/Pack differentiation.

**C11. Security confirmation UI needs three-layer progressive disclosure.**  
(1) one-sentence ask (2) risk + preview (3) whitelist/nonce/worker meta expanded. Current full dialog dumps too much at once for Panel.

**C12. Empty-state suggested prompts + unified composer are high-leverage polish.**  
Gemini/Claude-style page-aware suggestions; attach/`/`/send inside one rounded composer.

---

## Explicit non-claims (do not treat as settled)

- Exact accent hex / typeface beyond Inter/system stack
- Whether L1 Cockpit expand remains user-only (already locked in three-mode D9′)
- Full redesign of security policy or Companion APIs
- Copy of Gemini native chrome (we cannot ship as Google)

---

## Required grounding files for reviewers

1. `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md`
2. `docs/DESIGN.md`
3. `chrome-extension/src/sidepanel/ui/tokens.ts`
4. `chrome-extension/src/sidepanel/App.tsx` (Header, InputArea, SecurityConfirmationDialog, styles)
5. `chrome-extension/src/sidepanel/components/BottomBar.tsx`
6. `chrome-extension/src/sidepanel/mode/mode-controller.ts`
7. `docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md` (prior dual review)
8. Spot-check: `ChatView.tsx`, `SafetyStrip.tsx`, `ComputerTaskBar.tsx`

---

## Success criteria for this validation pass

1. Each claim C1–C12: **CONFIRMED** | **AMEND** | **REJECT** with code/doc evidence.
2. List **missing claims** the prior analysis should have included.
3. Produce **final recommended conclusions** safe to drive P0 UI work.
4. Flag conflicts with already-approved three-mode redesign.
