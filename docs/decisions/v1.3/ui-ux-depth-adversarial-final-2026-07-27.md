# UI/UX Design Claims — Adversarial Validation Report

Workflow: `ui-ux-design-adversarial`
Brief: `docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md`

## 1. Grounding (code inventory)

```json
{"chrome_inventory":["Header: ThreadList + title + Craft/Export/NB-import/NB-save/Summary/Logs icons + ModeBadge + connection dot","ChatView stream (primary flex column)","ComputerTaskBar (shown when level !== computer)","FleetStrip always (idle「舰队」or expanded multi-agent strip)","BottomBar mode-filtered tabs (L0 up to 5: skills/knowledge/packs/board/history)","InputArea: textarea + attach + send|stop + settings","SafetyStrip only when L2 (TaskChip + abort + MinimalConfirm + 确认台)","SecurityConfirmationDialog modal (non-L2 pending confirms; full dump)","SettingsSlideout + McpServerForm + optional SkillCraft/NotebookLM/LogBar overlays","DisconnectedBanner when connectionState===disconnected","Toast for auto-skill match / mode escalate"],"conflicts_with_three_mode":["C8 hides Skills/Packs/Knowledge/MCP/Apps behind `/`+settings only — reverses locked D5 and §4 ContextBar (L0 Skills·Know·Hist; L1 Tabs·Skills)","C7 BottomBar 0–2 entries is stricter than approved §4 ContextBar 2–3 + `/`","C10 P0=visual-unify-first conflicts three-mode P0 acceptance (ModeController/badge/tab-split first; full dual-skin tokens are P2/D6)","Implemented L2 ContextBar still shows tabs/apps/mcp/board — conflicts §4 L2 ContextBar Minimal/hidden if treated as product law"],"evidence_paths":["docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md:19-67","docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md:31-50,95-118,166-180","docs/DESIGN.md:5-86","chrome-extension/src/sidepanel/ui/tokens.ts:1-58","chrome-extension/src/sidepanel/App.tsx:144-181,248-547,575-793,1058-1174,1246-1393","chrome-extension/src/sidepanel/components/BottomBar.tsx:30-52,633-665","chrome-extension/src/sidepanel/mode/mode-controller.ts:73-136","chrome-extension/src/sidepanel/components/SafetyStrip.tsx:11-85","chrome-extension/src/sidepanel/components/ChatView.tsx:47-57,723-848","chrome-extension/src/sidepanel/components/FleetStrip.tsx:22-53","docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md:23-85"],"mode_alignment":"Partial P0/P1: mode-controller deriveCapabilityLevel + badge + L2 SafetyStrip/Cockpit open match D1/D10'/D13; BottomBar filters via contextBarTabsForLevel but L0=5/L1=4/L2=4 tabs (packs/board always) — exceeds locked §4 (Skills·Know·Hist / Tabs·Skills / minimal) and D5 2–3. No ContextStrip/展开工作区. Header still 6 permanent power icons (not decluttered). ComputerTaskBar kept for non-L2 (P0 OK).","token_inconsistencies":["chrome-extension/src/sidepanel/components/ChatView.tsx: userBubble #4A90D9; status/tool #4A90D9/#F44336/#4CAF50/#FF9800; 🤔/⚙️ status labels","chrome-extension/src/sidepanel/App.tsx: SecurityConfirmationDialog risk #FFC107/#FF9800/#F44336; nonce #4CAF50; HighlightedCode #4A90D9; ErrorBoundary Material colors","chrome-extension/src/sidepanel/components/BottomBar.tsx: mode switcher/history/groupHeader #4A90D9/#4CAF50/#F44336; skill import emoji chrome","chrome-extension/src/sidepanel/components/ComputerTaskBar.tsx: progress #F44336/#4CAF50/#FFC107/#2196F3 (not tokens)","chrome-extension/src/sidepanel/components/MinimalConfirm.tsx: risk colors #FF9800/#F44336","chrome-extension/src/sidepanel/App.tsx Header L1 tint #f5f9ff (spec/DESIGN #eef4ff; tokens.modeBrowserBg #dbeafe)","docs/DESIGN.md: Connection/Message/Buttons still document #4A90D9/#F44336/#4CAF50/#FF9800 vs tokens #2563eb/#dc2626/#16a34a","Multiple panels (SettingsSlideout, McpPanel, AppsPanel, KnowledgeSubPanel, SkillCraftPanel, ThreadList): primary actions hardcode #4A90D9"]}
```

## 2. Per-claim adversarial verdicts

### C1 — **CONFIRMED** (high)

- Reason: Repo shows permanent multi-surface chrome in ~320px (Header 6 power icons, FleetStrip always, BottomBar 4–5 tabs vs locked §4 2–3/minimal, task/confirm overlays) plus dual color systems: tokens.ts (#2563eb/#dc2626) coexist with ~89 Material hexes (#4A90D9/#F44336/#4CAF50/#FF9800) across ChatView/App/Security/ComputerTaskBar/panels; DESIGN.md documents both. Clutter is IA progressive-disclosure failure + inconsistent visual execution, not missing product features. Does not conflict with three-mode ontology; sequencing conflict belongs to C10, not C1.
- Evidence: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md C1; docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §2.2 D5 + §4 Panel IA (Header declutter, ContextBar 2–3); chrome-extension/src/sidepanel/App.tsx AppContent stack + Header icon strip + SecurityConfirmationDialog Material colors; chrome-extension/src/sidepanel/mode/mode-controller.ts contextBarTabsForLevel L0=5/L1=4/L2=4; chrome-extension/src/sidepanel/ui/tokens.ts accent/danger/success; chrome-extension/src/sidepanel/components/ChatView.tsx userBubble #4A90D9; ComputerTaskBar/MinimalConfirm/BottomBar/Settings/Mcp/Apps Material hexes; docs/DESIGN.md split token table vs Components Quick Reference

### C2 — **AMEND** (medium)

- Reason: Direction is right as an anti–feature-landfill lesson (conversation-primary, restrained permanent chrome, tools not multi-tab nav), and it fits CMspark tokens/C9 quiet blue-neutral plus locked D5 stream-first IA. But the claim is non-operational poetry: (1) Gemini’s calm is not rigorously evidenced in-repo and is misframed as ‘not purple’ rather than density/hierarchy/host-context; (2) ‘implicit context’ misnames host/page-bound context that Gemini surfaces inherit; (3) ‘single conversation focus’ overstates Gemini-in-Chrome’s agent/multitask direction and conflicts with locked three-mode chrome (D5 ContextBar 2–3, D10′ SafetyStrip, D13 mode badge, §4 L1 ContextStrip) if taken literally. Confirm the design rules, not the brand mythology.
- Evidence: Brief C2: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md:26-27 (also C7/C9). Locked three-mode: docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §1 landfill, §2.2 D5/D10′/D13, §4 Panel IA ContextStrip/ChatStream/ContextBar 2–3. Tokens/DESIGN quiet blue-neutral: chrome-extension/src/sidepanel/ui/tokens.ts:9-38; docs/DESIGN.md:5-17. Current chrome denser than Gemini lesson: BottomBar ALL_TABS + mode filter chrome-extension/src/sidepanel/components/BottomBar.tsx:30-52; inventory Header power icons + FleetStrip + ComputerTaskBar + SafetyStrip. External-knowledge limited: public Gemini-in-Chrome coverage emphasizes side panel + agents/multitask (not a measured ‘restraint/neutral/no-purple’ teardown); no Gemini DOM audit in this repo.
- Amendment: Adopt Gemini-like side-panel calm as operational IA—not brand purple: soft neutral surfaces, conversation stream as ≥primary vertical surface, page/host context as a chip/strip when relevant (not permanent multi-tool nav), and secondary power via `/`/settings—while keeping CMspark-required mode badge, mode-split ContextBar (D5/§4), and L2 SafetyStrip.

### C3 — **AMEND** (medium)

- Reason: Architecture-category overlap is well-supported (WebBridge = local bridge service + extension + CDP agent hands; CMspark = Companion WS + extension CDP — same dual-layer class, different product). Treating WebBridge as a Side Panel visual template is correctly rejected and already aligns with locked three-mode D6/§4 (L0/L1 conversation-first quiet-professional; dark/ops HUD only for escalated L2 Cockpit P2). However the claim overstates WebBridge UI as proven 'status/ops-first': repo has zero primary UI inventory of WebBridge (only this brief), and external coverage documents connection/status plumbing more than a full chrome design system. Prescription 'do not default to bridge-console aesthetics' is product-correct but must not be read as banning L2 SafetyStrip/TaskDock/step-rail ops chrome required by D7/D10′.
- Evidence: Brief C3: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md:29-30 (only in-repo WebBridge mention). CMspark topology: docs/architecture.md §1.1 dual-layer Extension↔WS↔Companion + CDP. Three-mode law: docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md D6/§4/§5 (L0/L1 light chat-primary; L2 dark HUD P2 Cockpit); locked D5/D6/D7/D10′ in ui-three-mode-redesign-brief-2026-07-26.md. Visual tokens: docs/DESIGN.md quiet-professional. Code ops chrome vs mode: App.tsx:156-166 (SafetyStrip + full confirm gated by isComputer; ComputerTaskBar still on !isComputer); ComputerTaskBar.tsx step/layer/ms/coords ops rail; mode-controller.ts:73-136. External (limited): WebBridge local CDP bridge + extension + agent-agnostic hands, Connected status — not a full UI template audit.
- Amendment: Kimi WebBridge is an architecture peer (local bridge + extension + CDP agent hands), not a Side Panel visual reference; keep default Panel conversation-first per three-mode D6/§4, and confine dense status/ops chrome (task rails, live HUD, heavy confirm) to escalated L2/Cockpit surfaces rather than inventing a global bridge-console skin.

### C4 — **AMEND** (high)

- Reason: Superlative 'best agent UX reference' is unsupported: repo has zero comparative Claude-vs-Gemini/Kimi UX audit; external docs show Claude-in-Chrome as chat+browser-action side panel, while slash-command depth is primarily Claude Code—not proven Chrome chrome. Chat-first + `/` for low-freq + progressive tools already match locked D5 and §4 (ContextBar 2–3 mode-split + `/`, ChatStream primary, header declutter)—so direction is partly right, but treating Claude as sole best template can rationalize C7/C8 (0–2 BottomBar / hide Skills·Packs·Know·MCP·Apps behind `/` only), which reverses D5/§4. CMspark-specific L2 dual-surface (SafetyStrip + Cockpit) and multi-module depth have no Claude Chrome equivalent; use Claude as one partial pattern source, not ranking winner.
- Evidence: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md:15,32-33 (C4 text only; competitors named, no ranking); docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md:39 D5 command-first + :95-116 §4 ChatStream primary, ContextBar 2–3 + `/`, L0 Skills·Know·Hist / L1 Tabs·Skills / L2 minimal, header declutter; chrome-extension/src/sidepanel/mode/mode-controller.ts:124-135 contextBarTabsForLevel; chrome-extension/src/sidepanel/components/SlashCommandPopover.tsx + App.tsx:1120-1127 existing `/` skill popover; grounding conflicts_with_three_mode C7/C8 vs D5/§4; external-knowledge limited: support/marketing describe side panel chat + page actions + permissions, not verified 'best' depth-without-bloat inventory or Chrome-native slash palette.
- Amendment: Claude-style chat-first stream + progressive tool outcomes + command palette (`/`) for low-frequency power is a useful partial UX reference for depth-without-bloat; keep it subordinate to locked D5/§4 (permanent 2–3 mode-split ContextBar entries + `/`/settings for the rest)—do not rank Claude in Chrome as sole/best reference over Gemini restraint (C2) or as license to zero permanent ContextBar.

### C5 — **AMEND** (high)

- Reason: Direction is right for a ~320px agent Panel: Sider/Monica-style always-visible multi-tool density is what CMspark must not ship as default chrome, and locked D5 + §4 ContextBar already require mode-split 2–3 entries + `/`/settings for low-freq (not 5–8 permanent tabs). Claim fails as written because (1) it condemns whole competitor products instead of the permanent multi-tool nav pattern, (2) external Sider/Monica evidence is marketing/category-level only, and (3) unbounded 'must avoid multi-tool nav' is already used to justify C7/C8, which reverse locked D5 and §4 (L0 Skills·Know·Hist / L1 Tabs·Skills stay in ContextBar). Current code (BottomBar 8 tab types; L0=5/L1=4/L2=4 via contextBarTabsForLevel; header power icons) validates the density problem but also shows the fix is mode-split declutter, not zero tool chrome.
- Evidence: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md C5/C7/C8; docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §2.2 D5, §4 ContextBar + header declutter; chrome-extension/src/sidepanel/components/BottomBar.tsx ALL_TABS + contextBarTabsForLevel filter; chrome-extension/src/sidepanel/mode/mode-controller.ts contextBarTabsForLevel L0=skills/knowledge/packs/board/history L1=tabs/skills/packs/board L2=tabs/apps/mcp/board; chrome inventory Header multi-icon chrome; external: Sider multi-surface IA + Monica all-in-one/feature-creep category (web, limited).
- Amendment: Treat Sider/Monica-style permanent multi-tool nav density as an anti-pattern for CMspark default Panel chrome; operational rule is D5/§4 mode-split ContextBar (2–3 entries by level) + `/`/settings for low-freq tools—not zero ContextBar and not wholesale product bans.

### C6 — **CONFIRMED** (high)

- Reason: L0/L1/L2 is locked D1 and dual-review consensus (no fourth user mode). Code implements CapabilityLevel (chat|browser|computer) × SurfaceLayout (panel|cockpit) via deriveCapabilityLevel from task/tools/confirms—not BottomBar selection. App.tsx escalates L2 via SafetyStrip + Cockpit/confirm split and composer queue ownership. BottomBar only mode-filters ContextBar (D5); over-tab counts vs §4 are density debt for C7/D5, not evidence against the ontology or against 'depth via mode/surface, not more permanent tabs.'
- Evidence: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md C6; docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §2.1–2.2 D1–D5/D8/D10' + §3 ModeController + §4 ContextBar; docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md consensus keep ontology / no fourth mode; chrome-extension/src/sidepanel/types.ts CapabilityLevel+SurfaceLayout; mode-controller.ts deriveCapabilityLevel + contextBarTabsForLevel; App.tsx:156-166 SafetyStrip/ComputerTaskBar/confirm gating + InputArea L2 queue; SafetyStrip.tsx L2 chip+abort+MinimalConfirm+确认台; BottomBar.tsx filters via contextBarTabsForLevel; docs/DESIGN.md mode badge + Panel L2/Cockpit; FleetStrip ops-only (not CapabilityLevel).

### C7 — **AMEND** (high)

- Reason: Conversation-first Panel is locked (§4 ChatStream primary; D5 mode-split + command-first for low-freq), but C7 overstates it with three non-law details: (1) ≥70% stream is unmeasured and not in any approved doc/acceptance test; (2) header via ⋯ is not mandated—§4 says Craft/NB/logs → settings or `/`, while code still shows 6 permanent header icons; (3) BottomBar 0–2 directly conflicts locked §4 ContextBar 2–3 (L0 Skills·Know·Hist; L1 Tabs·Skills; L2 minimal/hidden) and D5. Live contextBarTabsForLevel is even denser (L0=5/L1=4/L2=4 with packs/board). Default REJECT fails because direction is right; CONFIRMED fails because the operational rules fight approved IA.
- Evidence: docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §2.2 D5 + §4 lines 95-117 (ContextBar 2–3 + `/`; header declutter to settings/`/`); docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md C7 + conflicts_with_three_mode; chrome-extension/src/sidepanel/App.tsx:144-162,575-792 (layout + 6 header power icons, no ⋯); chrome-extension/src/sidepanel/mode/mode-controller.ts:125-136 (tabs 5/4/4); chrome-extension/src/sidepanel/components/BottomBar.tsx:30-52,633-665; ChatView flex:1 only (no 70% budget); docs/DESIGN.md mode badge/BottomBar note only
- Amendment: Default Panel is conversation-first (ChatStream is the primary flex region per three-mode §4); declutter permanent header power icons into settings/`/` (⋯ is optional chrome, not law); keep ContextBar mode-split at 2–3 entries (L0 Skills·Know·Hist; L1 Tabs·Skills; L2 minimal/hidden) plus `/`, not 0–2; low-frequency power only via `/` and settings (D5).

### C8 — **REJECT** (high)

- Reason: C8’s depth matrix is not product-correct: the lead row hides Skills/Packs/Knowledge/MCP/Apps behind only `/`+settings, which reverses locked three-mode D5 and §4 ContextBar (L0 Skills·Know·Hist; L1 Tabs·Skills; Cockpit Tabs·Apps·MCP). Code agrees with mode-split permanent tabs, not C8: contextBarTabsForLevel still exposes skills/knowledge/packs/board (L0), tabs/skills/packs/board (L1), tabs/apps/mcp/board (L2) via BottomBar. L1 page-context chip/ContextStrip is specified but unimplemented. Secondary rows are only partial truths (ToolCallCard in-message; L2 SafetyStrip+Cockpit CU/confirm split; L0/L1 still full SecurityConfirmationDialog) and cannot salvage a matrix whose primary IA rule conflicts with approved product law.
- Evidence: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md:C8 matrix; docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md:D5,§4 ContextBar L0/L1/L2 + ContextStrip; chrome-extension/src/sidepanel/mode/mode-controller.ts:contextBarTabsForLevel 125-136; BottomBar.tsx:ALL_TABS + mode filter 30-52; App.tsx:136-166 L2 SafetyStrip/Cockpit vs full dialog; SafetyStrip.tsx:TaskChip+急停+确认台+MinimalConfirm; ChatView.tsx:289-291 ToolCallCard; no ContextStrip/page-context chip under sidepanel/; DESIGN.md Tool Call Card

### C9 — **CONFIRMED** (medium)

- Reason: Repo design law matches the claim: tokens.ts + DESIGN.md define quiet-professional soft neutrals and single blue accent #2563eb; dark tokens and implementation are scoped to L2 SafetyStrip and Cockpit (not L0/L1 panel chrome); three-mode §7/D6 reserve full dual-skin dark HUD for P2 while L1 uses blue tint. Grep finds no product purple palette—only the brief’s anti-pattern wording. Residual #4A90D9 hardcodes are token-inconsistency (C10), not a competing purple/dark direction.
- Evidence: chrome-extension/src/sidepanel/ui/tokens.ts:1-49 (quiet-professional; accent #2563eb; dark* labeled L2 SafetyStrip/Cockpit); docs/DESIGN.md:1-19,56-58; docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md:40(D6),164-178(§7 mode signal + token direction); chrome-extension/src/sidepanel/components/SafetyStrip.tsx:91-98 dark gradient; chrome-extension/src/sidepanel/App.tsx:156 SafetyStrip only if computer, 666-671 L1 blue / L2 light header, 1254+ light tokens.bg*; chrome-extension/src/cockpit/CockpitApp.tsx:593-624 #141820 shell; chrome-extension/src/sidepanel/ui/ModeBadge.tsx L0 neutral/L1 blue/L2 green—no purple in sidepanel palette

### C10 — **AMEND** (high)

- Reason: Diagnosis of symptoms is directionally right (hardcoded Material #4A90D9/#F44336 still widespread; header/BottomBar density exceeds locked §4; SecurityConfirmationDialog is full-dump utilitarian) but mis-ranks root cause and invents a phase order that conflicts product law. Three-mode §1 states tokens exist and IA does not; D6 + §6 + dual-review synthesis lock P0=ModeController/badge/BottomBar split (mode awareness), P1=Cockpit+confirm content-split, P2=semantic tokens/dual-skin polish. Claim's P0=visual-unify-first → P1=IA cut → P3=Cockpit reverses that sequence and would mis-spend P0 on paint over mode/IA acceptance.
- Evidence: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md:59-60 (C10); docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md:13-15 (IA not tokens as problem), :39-40 D5, :40 D6 dual-skin P2, :95-118 §4 ContextBar 2–3 + header declutter, :166-180 mode signal P0–P1 / tokens P2, :186-224 phasing; docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md:30,54-55,70,74-84 (P0 mode awareness; P2 dual-skin after tokens); chrome-extension/src/sidepanel/ui/tokens.ts:1-58 (#2563eb system); docs/DESIGN.md:5-18 vs :50-86 (docs dual color systems); chrome-extension/src/sidepanel/mode/mode-controller.ts:125-136 (L0 5 tabs / L1 4 / L2 4 vs §4); ChatView/BottomBar/ComputerTaskBar/MinimalConfirm/App SecurityConfirmationDialog hardcoded #4A90D9/#F44336/#FF9800; App.tsx Header permanent Craft/NB/export/logs icons + ModeBadge
- Amendment: Ugly gap = chrome density/IA landfill primary, plus token dual-system and utilitarian chat/confirm; fix order must follow locked three-mode D6/§6: P0 mode awareness + ContextBar cut (badge/split), P1 Cockpit + confirm content-split, P2 semantic-token unify + dual-skin polish — not visual-unify-first then IA cut.

### C11 — **AMEND** (high)

- Reason: Panel overload is real for L0/L1 SecurityConfirmationDialog (badge+APIs+defense_layer+preview+whitelist+thread/session trust+nonce+queue in one modal), but the locked product law is D10′ content-split (Panel minimal tool/risk/allow-deny-stop; Cockpit ConfirmElevated for preview/nonce/whitelist/session-trust)—already implemented for L2 via SafetyStrip/MinimalConfirm—not a three-layer progressive-disclosure accordion. C11 layer (2) putting preview on Panel and layer (3) burying worker meta conflict with D10′, the §5 confirm table, review synthesis, and C8 (Minimal strip + Cockpit full). Residual gap: shrink L0/L1 full dialog to match that split, not invent new three-layer IA.
- Evidence: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md C8/C11; docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md D10′ + §5 Confirm content-split table; docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md (panel 4-line / cockpit heavy); chrome-extension/src/sidepanel/App.tsx:156-166,184-547 (L2 gates full dialog; SecurityConfirmationDialog dumps all fields); chrome-extension/src/sidepanel/components/MinimalConfirm.tsx:1-145 + SafetyStrip.tsx:82; chrome-extension/src/cockpit/CockpitApp.tsx ConfirmElevated:275-493
- Amendment: Security confirm must follow locked D10′ content-split: Panel = one-line tool/risk + allow/deny/stop (L2 MinimalConfirm already); preview/nonce/whitelist/session-trust only in Cockpit ConfirmElevated (or equivalent elevated details)—not three progressive layers inside the ~320px Panel; residual work is aligning L0/L1 away from full SecurityConfirmationDialog dump to that same split.

### C12 — **AMEND** (medium)

- Reason: Repo confirms a barren empty stream (static copy only) and a fragmented InputArea (textarea + attach + send/stop + settings as sibling chrome, not one capsule), so polish opportunity exists. But 'high-leverage' is false against locked three-mode P0 (mode badge/Controller/ContextBar) and C10's own order (empty state = P2 after visual unify + IA cut). Page-aware suggestion chips are a product/context feature (depends on L1 ContextStrip/tab truth), not pure polish, and locked §6 Empty specifies mode-differentiated welcome/no-tab/cockpit copy—not Gemini-style prompt grids. Unified composer is low-risk visual grouping of already-working attach/slash/send; real IA win is ejecting settings/power chrome from the input row and fixing density first. Acting on C12 as high leverage causes priority inversion; ignoring it only misses late polish.
- Evidence: docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md C10–C12 (P2 empty state; C12 high-leverage wording); docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §4 Composer row, §6 Empty=L0 welcome/L1 no-tab/cockpit wait, §8 P0 mode vs P2 polish; chrome-extension/src/sidepanel/components/ChatView.tsx empty div '输入指令开始与 CMspark Agent 对话' (no suggestions); chrome-extension/src/sidepanel/App.tsx InputArea ~796–1174 (slash popover, file attach, L2 placeholders, separate attach/send/settings buttons + styles.inputArea/textarea ~1313–1393); docs/DESIGN.md Input = separate border/radius; no page-aware empty chips in sidepanel inventory.
- Amendment: Mode-aware empty copy (L0 welcome / L1 no-tab per three-mode §6) and visual composer unification of existing attach/`/`/send (settings out of the row) are worthwhile P2 polish after IA/token work—not high-leverage P0; page-aware suggestion chips need ContextStrip/tab context and explicit mode gating, not permanent chrome.

## 3. Internal synthesis

### Confirmed

- C1: Root problem is IA progressive-disclosure failure + inconsistent visual execution in ~320px—not missing features. Live chrome stacks Header multi-icon strip, FleetStrip, ComputerTaskBar, BottomBar 4–5 mode-filtered tabs, task/confirm overlays; tokens.ts (#2563eb/#dc2626) coexists with ~Material hexes (#4A90D9/#F44336/#4CAF50/#FF9800) across ChatView/App/BottomBar/ComputerTaskBar/MinimalConfirm/panels; DESIGN.md documents both systems.
- C6: L0/L1/L2 (chat|browser|computer) × SurfaceLayout (panel|cockpit) remains correct ontology. Depth escalates via ModeController/deriveCapabilityLevel + surfaces (SafetyStrip/Cockpit/confirm split), not permanent tab proliferation. Dual-review consensus: no fourth user mode; BottomBar only mode-filters ContextBar (D5).
- C9: Visual direction is quiet-professional soft neutrals + single blue accent #2563eb (tokens.ts / DESIGN.md); dark tokens scoped to L2 SafetyStrip and Cockpit shell (D6 P2 full dual-skin). No product purple palette; residual #4A90D9 is token debt, not a competing brand direction.

### Amended

- C2: Adopt Gemini-like side-panel calm as operational IA—not brand purple: soft neutral surfaces, conversation stream as primary vertical surface, page/host context as chip/strip when relevant, secondary power via `/`/settings—while keeping required mode badge, mode-split ContextBar (D5/§4), and L2 SafetyStrip.
- C3: Kimi WebBridge is architecture peer (local bridge + extension + CDP hands), not Side Panel visual reference; keep default Panel conversation-first (D6/§4); confine dense status/ops chrome (task rails, live HUD, heavy confirm) to escalated L2/Cockpit—do not invent a global bridge-console skin, and do not ban D7/D10′ L2 ops chrome.
- C4: Claude-style chat-first stream + progressive tool outcomes + `/` for low-frequency power is a useful partial UX reference; keep it subordinate to locked D5/§4 (permanent 2–3 mode-split ContextBar + `/`/settings)—not sole/best template and not license for zero permanent ContextBar.
- C5: Treat Sider/Monica-style permanent multi-tool nav density as an anti-pattern for default Panel chrome; operational rule is D5/§4 mode-split ContextBar (2–3 by level) + `/`/settings for low-freq—not zero ContextBar and not wholesale product bans.
- C7: Default Panel is conversation-first (ChatStream primary flex per §4); declutter permanent header power icons into settings/`/` (⋯ optional, not law); keep ContextBar mode-split at 2–3 (L0 Skills·Know·Hist; L1 Tabs·Skills; L2 minimal/hidden) plus `/`—not 0–2 and not an unmeasured ≥70% stream law.
- C10: Ugly gap = chrome density/IA landfill primary, plus token dual-system and utilitarian chat/confirm; fix order must follow D6/§6/§8: P0 mode awareness + ContextBar cut (badge/split), P1 Cockpit + confirm content-split, P2 semantic-token unify + dual-skin polish—not visual-unify-first then IA cut.
- C11: Security confirm follows locked D10′ content-split: Panel = one-line tool/risk + allow/deny/stop (L2 MinimalConfirm already); preview/nonce/whitelist/session-trust only in Cockpit ConfirmElevated—not three progressive layers inside ~320px Panel; residual work is aligning L0/L1 away from full SecurityConfirmationDialog dump to that split (full modal allowed only as P0 keep until P1).
- C12: Mode-aware empty copy (L0 welcome / L1 no-tab per §6) and visual composer unification of attach/`/`/send (settings out of the row) are P2 polish after IA/token work—not high-leverage P0; page-aware suggestion chips need ContextStrip/tab context and mode gating, not permanent chrome.

### Rejected

- C8: Depth entry matrix is not product-correct. Hiding Skills/Packs/Knowledge/MCP/Apps behind only `/`+settings reverses locked D5 and §4 ContextBar (L0 Skills·Know·Hist; L1 Tabs·Skills; Cockpit Tabs·Apps·MCP). Code agrees with mode-split permanent tabs (contextBarTabsForLevel), not C8. Secondary rows (in-message ToolCallCard; L2 Minimal+Cockpit full) are partial truths and cannot salvage the matrix.

### Missing claims (gaps)

- FleetStrip is always mounted (idle「舰队」or expanded) but is absent from locked §4 vertical order—needs a product rule: hide when idle/single-agent, or demote to L2/Cockpit/ops-only.
- 320px vertical budget math: Header + optional ContextStrip + SafetyStrip/ComputerTaskBar + ChatStream + ContextBar + Composer + overlays—no measured min-height / collapse rules or acceptance for stream remaining usable under stacked strips.
- L0/L1 multi-confirm / multi-worker storms: queue badge, ordering, and whether Panel ever shows more than one MinimalConfirm line before P1 Cockpit focus+timeout (D14).
- a11y: badge aria-live, risk never color-only, prefers-reduced-motion ≤200ms (spec §7) are not in C1–C12; no claim on keyboard path for ContextBar/`/`/confirm allow-deny.
- i18n/density: Chinese mode labels (聊/网页/计算机) and confirm copy length vs 320px; no localization claim for truncated risk strings.
- Onboarding/pairing: tray pairing-code window and DisconnectedBanner are first-run UX outside the claims set; pairing vs chat-first chrome competition unaddressed.
- Header L1 tint inconsistency (#f5f9ff vs DESIGN #eef4ff vs tokens.modeBrowserBg #dbeafe) and mode-signal flash/FOUC on L2 escalate (light panel → dark SafetyStrip).
- board tab is always in live contextBarTabsForLevel for all levels but not in §4 ContextBar tables—open whether Board is permanent ContextBar, `/`, or L2-only.
- Open question only: whether MCP/Apps ever become a user mode (P3+ in three-mode); do not invent a fourth CapabilityLevel without new evidence.
- ComputerTaskBar non-L2 visibility vs §4 P0 keep / P1 relocate: claims treat it as clutter without stating the locked P0 retention rule.

### Conflicts with three-mode

- C8 primary matrix vs locked D5 + §4: Skills·Know·Hist (L0) and Tabs·Skills (L1) must stay mode-split permanent ContextBar entries, not `/`-only.
- C7 BottomBar 0–2 vs approved §4 ContextBar 2–3 + `/` (L0 three entries; L1 two; L2 minimal/hidden).
- C10 claimed phase P0 visual-unify → P1 IA cut → P3 Cockpit vs three-mode §8/D6: P0 ModeController/badge/BottomBar split; P1 Cockpit+confirm content-split; P2 tokens/dual-skin.
- C11 three-layer progressive disclosure inside Panel vs locked D10′ + §5 content-split table (Panel minimal; Cockpit preview/nonce/whitelist/session-trust).
- Live contextBarTabsForLevel (L0=5 skills/knowledge/packs/board/history; L1=4 tabs/skills/packs/board; L2=4 tabs/apps/mcp/board) exceeds §4 (Skills·Know·Hist / Tabs·Skills / Minimal·hidden) and D5 2–3 cap.
- Live Header permanent Craft/NB/export/logs icons conflict §4 header declutter (those → settings or `/`); settings still also in composer row.
- C7 unmeasured ≥70% stream budget is not in any approved acceptance test; §4 only requires ChatStream as primary scroll region.

### Final conclusions (internal)

1. 1. Keep CapabilityLevel L0|L1|L2 and SurfaceLayout panel|cockpit; derive level from task/tools/confirms/tray, never from BottomBar selection; no fourth user mode without new product decision.
2. 2. Side Panel vertical law (§4): Header (threads, mode badge, connection, settings) → L1 ContextStrip → L2 SafetyStrip → ChatStream (primary flex) → ContextBar 2–3 mode-split + `/` → Composer; do not add permanent multi-tool nav.
3. 3. ContextBar product targets: L0 Skills·Know·Hist; L1 Tabs·Skills; L2 minimal/hidden (Cockpit owns Tabs·Apps·MCP). Move packs/board (and excess L2 tabs) to `/` or settings until a separate decision promotes them.
4. 4. Header declutter: Craft / NotebookLM / logs / bulk export leave the permanent icon strip for settings or `/`; ModeBadge + connection remain visible (D13).
5. 5. Conversation-first means ChatStream is the primary flex region under competing strips—not a numeric ≥70% law and not zero ContextBar.
6. 6. Security UX law is D10′ content-split, not a three-layer Panel accordion: Panel shows tool+risk color+allow/deny/stop (and L2 mandatory abort); preview/nonce/whitelist/session-trust/queue detail live in Cockpit ConfirmElevated. P0 may keep full SecurityConfirmationDialog for L0/L1; P1 aligns L0/L1 toward the same minimal Panel pattern once Cockpit path exists.
7. 7. Visual system: single quiet-professional token set (accent #2563eb, danger/success/warning from tokens.ts); kill Material hardcodes progressively in P2; L0/L1 stay light; dark HUD only L2 SafetyStrip + Cockpit (full dual-skin P2 per D6).
8. 8. Phase order is locked: P0 mode awareness + ContextBar cut + badge/toast/hysteresis stub (ComputerTaskBar + full confirm stay in panel); P1 Cockpit dual-track + confirm split + Panel SafetyStrip + input ownership; P2 semantic tokens, L1 expand user-only, empty/composer polish, dual-skin.
9. 9. Competitor use: Gemini = restraint/density lesson; Claude = chat-first + `/` partial pattern; WebBridge = architecture class not skin; Sider/Monica multi-tool permanence = anti-pattern—never rank one as sole template over D5/§4.
10. 10. Low-frequency power (MCP servers form, skill craft, NB import/export, logs, packs when demoted) enters via `/` and settings, not permanent header icons or 5–8 BottomBar tabs.
11. 11. L1 page context is a ContextStrip/chip (tab/target +「展开工作区」), not another permanent BottomBar tool tab; implement when mode P0 is stable.
12. 12. Empty state and unified composer are P2: mode-differentiated copy per §6; group attach/`/`/send; eject settings from the input row; page-aware suggestion chips only with real tab context and mode gating.

### P0 actions

- mode-controller.ts: Change contextBarTabsForLevel to §4 — L0 [skills, knowledge, history]; L1 [tabs, skills]; L2 [] or single optional entry; remove packs/board from default permanent lists (route via `/`/settings).
- BottomBar.tsx: Drive visible tabs solely from the tightened contextBarTabsForLevel; drop UI that implies full ALL_TABS six-pack when filtered shorter; keep `/` affordance discoverable.
- App.tsx Header: Remove permanent Craft / NotebookLM / logs / bulk-export icon strip; leave ThreadList + title + ModeBadge + connection; park power actions in SettingsSlideout and/or SlashCommandPopover.
- App.tsx InputArea: Move settings control out of the composer sibling row into Header/settings only (composer = textarea + attach + send|stop; slash already via SlashCommandPopover).
- App.tsx / ModeBadge: Ensure D13 escalate toast + badge aria-live on level up; verify L1 header tint uses tokens.modeBrowserBg or DESIGN #eef4ff (not ad-hoc #f5f9ff) without full dual-skin work.
- FleetStrip.tsx + App.tsx: Gate FleetStrip so idle single-agent does not consume permanent vertical chrome (show only multi-agent active or L2/ops)—align with §4 stack.
- ComputerTaskBar.tsx: Keep for non-L2 in P0 per spec, but cap height and avoid Material progress hexes for any new styles; do not relocate to Cockpit until P1.
- Do not spend P0 on wholesale #4A90D9→#2563eb sweeps or empty-state suggestion grids; schedule token unify + composer capsule + mode-aware empty copy for P2 after ContextBar/header cut lands.

### Risks

- Cutting packs/board from ContextBar may hide Mission Pack / Board discovery for power users who relied on permanent tabs—mitigate with `/` commands, settings entries, and one release-note toast.
- Over-aggressive L2 ContextBar hidden + concurrent SafetyStrip/TaskChip can strand users who need Tabs/Apps/MCP mid-task if Cockpit fails to open or loses focus (D11′/D8 dependency).
- Shrinking L0/L1 SecurityConfirmationDialog before P1 Cockpit content-split can bury whitelist/nonce/session-trust and increase mis-approvals or force unsafe auto_approve workarounds.
- Header declutter that removes export/logs without parity in settings/`/` regresses Obsidian export and debug workflows used by power users.
- Treating Gemini/Claude calm as 'less chrome always' can under-signal L2 LIVE risk (abort, confirm timeout D14) and weaken security UX.
- Token/visual unify-first (if P0 is misread) delays mode acceptance tests and can paint over still-wrong IA (landfill remains under new colors).
- Hiding FleetStrip without a multi-agent entry path reduces multi-worker visibility during parallel runs.
- Composer-only `/` for Skills/Knowledge (if C8 is reintroduced) conflicts with D5 and will re-open the density debate with no permanent mode-split anchors.

## 4. External dual review (Claude + Pi)

- claude: APPROVE_WITH_NITS
- pi: APPROVE
- both_approve: true
- exit_code: 0
- claude_path: `/Users/huchen/Projects/cmspark/docs/audit/reviews/ui-ux-depth-claude-20260727-163105.md`
- pi_path: `/Users/huchen/Projects/cmspark/docs/audit/reviews/ui-ux-depth-pi-20260727-163105.md`
- verdict_json: `/Users/huchen/Projects/cmspark/docs/audit/reviews/ui-ux-depth-verdict-20260727-163105.json`

### raw_tail

```
[dual-review] launching Claude Code (separate process) for ui-ux-depth ...
[dual-review] Claude exit=0 → /Users/huchen/Projects/cmspark/docs/audit/reviews/ui-ux-depth-claude-20260727-163105.md
[dual-review] launching Pi Agent (separate process) for ui-ux-depth ...
[dual-review] Pi exit=0 → /Users/huchen/Projects/cmspark/docs/audit/reviews/ui-ux-depth-pi-20260727-163105.md
[dual-review] claude=APPROVE_WITH_NITS pi=APPROVE both_ok=true
[dual-review] verdict → /Users/huchen/Projects/cmspark/docs/audit/reviews/ui-ux-depth-verdict-20260727-163105.json
EXIT_CODE=0
```

## 5. FINAL recommended conclusions (post Claude/Pi)

### Confirmed

- C1: Root problem is IA progressive-disclosure failure + inconsistent visual execution in ~320px—not missing features. Live stack: Header multi-icon strip, always-mounted FleetStrip, ComputerTaskBar, BottomBar 4–5 tabs, task/confirm overlays; tokens.ts (#2563eb/#dc2626) coexists with ~70–89 Material hexes across 13 sidepanel files; DESIGN.md documents both systems. Dual-review verified.
- C6: L0/L1/L2 (chat|browser|computer) × SurfaceLayout (panel|cockpit) remains correct ontology. Depth via ModeController/deriveCapabilityLevel + surfaces (SafetyStrip/Cockpit/confirm split), not permanent tab proliferation. No fourth user mode; BottomBar only mode-filters ContextBar (D5).
- C9: Visual direction = quiet-professional soft neutrals + single blue accent #2563eb (tokens.ts / DESIGN.md); dark tokens scoped to L2 SafetyStrip + Cockpit shell (D6 P2 full dual-skin). No product purple; residual #4A90D9 is token debt, not competing brand.

### Amended (use these wordings)

- C2: Gemini-like calm = operational IA (soft neutrals, ChatStream primary, page/host as chip/strip, power via `/`/settings)—not brand purple or Google chrome; keep ModeBadge, mode-split ContextBar (D5/§4), L2 SafetyStrip.
- C3: Kimi WebBridge = architecture peer (local bridge + extension + CDP hands), not Panel visual reference; conversation-first default (D6/§4); dense status/ops chrome only on escalated L2/Cockpit—do not invent bridge-console skin or ban D7/D10′ L2 ops chrome.
- C4: Claude chat-first + progressive tools + `/` is a partial pattern already encoded in D5/§4; subordinate to permanent 2–3 mode-split ContextBar + `/`/settings—not sole template and not license for zero ContextBar (external: citing Claude adds little beyond locked law).
- C5: Sider/Monica permanent multi-tool nav density = anti-pattern for default Panel; rule is D5/§4 mode-split ContextBar (2–3 by level) + `/`/settings—not zero ContextBar and not wholesale product bans.
- C7: Conversation-first = ChatStream primary flex per §4; declutter header power icons into settings/`/`; ContextBar 2–3 mode-split (L0 Skills·Know·Hist; L1 Tabs·Skills; L2 minimal/hidden) + `/`—not 0–2 and not unmeasured ≥70% stream law.
- C10: Ugly gap = chrome density/IA landfill primary + dual token system + utilitarian confirm; fix order D6/§6/§8: P0 mode awareness + ContextBar cut, P1 Cockpit + confirm content-split, P2 semantic-token unify + dual-skin—not visual-unify-first.
- C11: Security UX = D10′ content-split: Panel one-line tool/risk + allow/deny/stop (L2 MinimalConfirm); preview/nonce/whitelist/session-trust only in Cockpit ConfirmElevated—not three layers inside ~320px Panel; P0 keep full SecurityConfirmationDialog for L0/L1 until P1 Cockpit path.
- C12: Mode-aware empty copy (§6) and composer unify (attach/`/`/send; settings out of row) are P2 polish after IA/token work—not high-leverage P0; page-aware chips need ContextStrip + mode gating.

### Rejected

- C8: Depth entry matrix is not product-correct. Hiding Skills/Packs/Knowledge/MCP/Apps behind only `/`+settings reverses locked D5 and §4 ContextBar (L0 Skills·Know·Hist; L1 Tabs·Skills; Cockpit Tabs·Apps·MCP). Code agrees with mode-split permanent tabs (contextBarTabsForLevel), not C8. Secondary rows (in-message ToolCallCard; L2 Minimal+Cockpit full) are partial truths and cannot salvage the matrix. Dual-review both confirm REJECT.

### Gaps still open

- FleetStrip always mounted (idle「舰队」) but absent from locked §4—product rule now: hide when idle/single-agent; show multi-agent active or L2/ops only.
- 320px vertical budget math: Header + optional ContextStrip + SafetyStrip/ComputerTaskBar + gated FleetStrip + ChatStream + ContextBar + Composer + overlays—no measured min-height/collapse rules or stream-usability acceptance under stacked strips.
- L0/L1 multi-confirm / multi-worker storms: queue badge, ordering, and whether Panel ever shows more than one confirm line before P1 Cockpit focus+timeout (D14).
- a11y: badge aria-live, risk never color-only, prefers-reduced-motion ≤200ms (§7); keyboard focus order when ContextBar shrinks 5→2; keyboard path for ContextBar/`/`/MinimalConfirm allow-deny-stop—absent from C1–C12.
- i18n/density: Chinese mode labels (聊/网页/计算机) and confirm copy length vs 320px; no localization claim for truncated risk strings.
- Onboarding/pairing: tray pairing-code window + DisconnectedBanner compete with ChatStream-first ~320px; first-run calm-by-default unaddressed.
- Header L1 tint inconsistency (#f5f9ff App vs DESIGN #eef4ff vs tokens.modeBrowserBg #dbeafe) and L2 escalate FOUC (light panel → dark SafetyStrip).
- Board tab always in live contextBarTabsForLevel for all levels but not in §4—open whether permanent ContextBar, `/`, or L2/Cockpit-only.
- MinimalConfirm/SafetyStrip still use Material risk hexes (#FFC107/#FF9800/#F44336) on dark gradient; tokens lack darkWarning/darkWarningSoft—P2 token gap, not P0.
- Open question only: whether MCP/Apps ever become a user mode (P3+); do not invent a fourth CapabilityLevel without new evidence.

### Conflicts

- C8 primary matrix vs locked D5 + §4: Skills·Know·Hist (L0) and Tabs·Skills (L1) must stay mode-split permanent ContextBar, not `/`-only.
- C7 BottomBar 0–2 vs approved §4 ContextBar 2–3 + `/` (L0 three; L1 two; L2 minimal/hidden).
- C10 claimed P0 visual-unify → P1 IA cut → P3 Cockpit vs locked §8/D6: P0 ModeController/badge/ContextBar cut; P1 Cockpit+confirm split; P2 tokens/dual-skin.
- C11 three-layer progressive disclosure inside Panel vs locked D10′ + §5 (Panel minimal; Cockpit preview/nonce/whitelist/session-trust).
- Live contextBarTabsForLevel L0=5/L1=4/L2=4 (incl. packs/board always; L2 tabs/apps/mcp/board) exceeds §4 (Skills·Know·Hist / Tabs·Skills / Minimal·hidden) and D5 2–3 cap.
- Live Header permanent Craft/NB/export/logs icons conflict §4 header declutter; settings still also in composer row; FleetStrip always-mounted but absent from locked §4 vertical order.
- Board tab in all live levels but not in §4 ContextBar tables—open product knob (permanent vs `/` vs L2/Cockpit-only).
- C7 unmeasured ≥70% stream budget not in any approved acceptance test; §4 only requires ChatStream as primary scroll region.

### Final conclusions

1. 1. Keep CapabilityLevel L0|L1|L2 and SurfaceLayout panel|cockpit; derive level from task/tools/confirms/tray, never from BottomBar selection; no fourth user mode without new product decision.
2. 2. Side Panel vertical law (§4 + dual-review FleetStrip fix): Header (threads, mode badge, connection, settings) → optional L1 ContextStrip → L2 SafetyStrip → FleetStrip only when multi-agent active or L2/ops → ChatStream (primary flex) → ContextBar 2–3 mode-split + `/` → Composer; no permanent multi-tool nav.
3. 3. ContextBar product targets: L0 Skills·Know·Hist; L1 Tabs·Skills; L2 Panel empty or single optional (Cockpit owns Tabs·Apps·MCP). Move packs/board and all L2 Panel tabs (tabs/apps/mcp/board) to `/`/settings or Cockpit until a separate decision promotes them.
4. 4. Header declutter: Craft / NotebookLM / logs / bulk export leave permanent icon strip for settings or `/`; ModeBadge + connection remain (D13). Composer = textarea + attach + send|stop only (settings out of input row).
5. 5. Conversation-first means ChatStream is the primary flex region under competing strips—not a numeric ≥70% law and not zero ContextBar.
6. 6. Security UX law is D10′ content-split: Panel tool+risk color+allow/deny/stop (L2 MinimalConfirm + mandatory abort); preview/nonce/whitelist/session-trust/queue detail in Cockpit ConfirmElevated. P0 must keep full SecurityConfirmationDialog for L0/L1; P1 aligns L0/L1 to minimal Panel once Cockpit path is reachable.
7. 7. Visual system: single quiet-professional token set (accent #2563eb; danger/success/warning from tokens.ts); P2 kill Material hardcodes with acceptance “0 new Material hexes; existing count monotonically decreasing” (incl. MinimalConfirm risk colors on dark SafetyStrip + darkWarning token gap); L0/L1 light; dark HUD only L2 SafetyStrip + Cockpit.
8. 8. Phase order locked: P0 mode awareness + ContextBar cut + badge/toast/hysteresis stub (ComputerTaskBar + full L0/L1 confirm stay in panel); P1 Cockpit dual-track + confirm content-split + Panel SafetyStrip + input ownership; P2 semantic tokens, empty/composer polish, dual-skin.
9. 9. Competitor use: Gemini = restraint/density lesson; Claude = chat-first + `/` partial pattern already in D5/§4; WebBridge = architecture class not skin; Sider/Monica multi-tool permanence = anti-pattern—never rank one sole template over D5/§4.
10. 10. Low-frequency power (MCP servers form, skill craft, NB import/export, logs, packs/board when demoted) enters via `/` and settings, not permanent header icons or 5–8 BottomBar tabs.
11. 11. L1 page context is ContextStrip/chip (tab/target +「展开工作区」), not another permanent BottomBar tool tab; implement when mode P0 is stable.
12. 12. Empty state and unified composer are P2: mode-differentiated copy per §6; group attach/`/`/send; eject settings from input row; page-aware suggestion chips only with real tab context and mode gating.
13. 13. External dual-review both_approve=true (Claude APPROVE_WITH_NITS, Pi APPROVE)—synthesis safe to drive P0; nits are scope polish (L2 cut explicitness, Board knob, a11y/pairing, token acceptance), not blockers.
14. 14. Open knobs (do not invent answers in P0): Board permanent vs `/` vs L2-only; whether MCP/Apps ever become a user mode (P3+); 320px min-height/collapse acceptance for stacked strips; multi-confirm queue UX before P1 Cockpit focus+timeout (D14).

### P0 actions (approved direction)

- mode-controller.ts: Set contextBarTabsForLevel to §4 — L0 [skills, knowledge, history]; L1 [tabs, skills]; L2 [] (Panel SafetyStrip-only; Cockpit owns Tabs·Apps·MCP). Remove packs/board and L2 tabs/apps/mcp/board from default permanent lists; route via `/`/settings or Cockpit.
- BottomBar.tsx: Drive visible tabs solely from tightened contextBarTabsForLevel; drop UI that implies full ALL_TABS six-pack when filtered shorter; keep `/` affordance discoverable.
- App.tsx Header: Remove permanent Craft / NotebookLM / logs / bulk-export icon strip; leave ThreadList + title + ModeBadge + connection; park power actions in SettingsSlideout and/or SlashCommandPopover with parity so export/logs are not lost.
- App.tsx InputArea: Move settings control out of the composer sibling row into Header/settings only (composer = textarea + attach + send|stop; slash via SlashCommandPopover).
- App.tsx / ModeBadge: Ensure D13 escalate toast + badge aria-live on level up; align L1 header tint to tokens.modeBrowserBg or DESIGN #eef4ff (not ad-hoc #f5f9ff) without full dual-skin work.
- FleetStrip.tsx + App.tsx: Gate FleetStrip so idle single-agent does not consume permanent vertical chrome (show only multi-agent active or L2/ops)—align with §4 stack; preserve multi-worker entry path when active.
- ComputerTaskBar.tsx: Keep for non-L2 in P0 per spec; cap height; do not relocate to Cockpit until P1; do not spend P0 rewriting existing Material progress hexes—defer those hardcodes to P2 token sweep.
- Confirm UX hold: Do not shrink L0/L1 SecurityConfirmationDialog in P0; keep full modal (nonce/whitelist/session-trust) until P1 Cockpit ConfirmElevated is generally reachable—only L2 uses MinimalConfirm + Cockpit deep-link.
- Do not spend P0 on wholesale #4A90D9→#2563eb sweeps, empty-state suggestion grids, or darkWarning token work; schedule token unify + composer capsule + mode-aware empty copy for P2 after ContextBar/header cut lands.
- Release note: Document packs/board demotion to `/`/settings with one toast or settings entry so Mission Pack / Board discovery is not silent-regressed.

### Risks

- Cutting packs/board from ContextBar may hide Mission Pack / Board discovery—mitigate with `/` commands, settings entries, and one release-note toast.
- Over-aggressive L2 ContextBar hidden + concurrent SafetyStrip/TaskChip can strand users who need Tabs/Apps/MCP mid-task if Cockpit fails to open or loses focus (D11′/D8 dependency)—P0 L2 [] assumes Cockpit path works for power tools.
- Shrinking L0/L1 SecurityConfirmationDialog before P1 Cockpit content-split can bury whitelist/nonce/session-trust and increase mis-approvals or force unsafe auto_approve workarounds—explicit P0 hold of full dialog mitigates.
- Header declutter that removes export/logs without parity in settings/`/` regresses Obsidian export and debug workflows used by power users.
- Treating Gemini/Claude calm as 'less chrome always' can under-signal L2 LIVE risk (abort, confirm timeout D14) and weaken security UX.
- Token/visual unify-first (if P0 is misread) delays mode acceptance tests and paints over still-wrong IA.
- Hiding FleetStrip without a multi-agent entry path reduces multi-worker visibility during parallel runs—gate on active multi-agent, not delete the surface.
- Composer-only `/` for Skills/Knowledge (if C8 is reintroduced) conflicts with D5 and re-opens the density debate with no permanent mode-split anchors.

---

*Generated by workflow ui-ux-design-adversarial*
