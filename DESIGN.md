# Design

## Source of truth
Active · 2026-09-07 · GitHub #469. This file owns product-wide UI/UX direction.
`docs/DESIGN.md` retains detailed capability and safety contracts; this revision
supersedes its consumer-mascot-first layout, tiny chrome and narrow-only shell.
Evidence: Sidepanel App, StatusRail, ThreadList, ChatView, ComposerDock,
ContextPanelHost, SettingsSlideout, shared tokens/Modal, Cockpit, graphs, terminal, capture and standalone web settings.
No current Codex screenshot was accessed: the reference is the user's stated
preference for quiet, spacious hierarchy, not a pixel-matching target.

## Brand
Calm, precise, capable. CMspark remains its own identity. Neutral paper and ink,
small existing mark, restrained indigo links/focus, semantic risk colors.
Avoid promotional dashboards, gradients, oversized mascots, dense icon ribbons,
unexplained technical acronyms and decorative status lights.

## Product goals
Make the next action obvious; keep conversation readable; let users find prior
work and supporting capabilities without remembering hidden menus. Preserve all
existing functions, confirmations, busy states and honest evidence gaps.
Success: no horizontal page overflow at 320px; usable content at 1440px; keyboard
reachable navigation/history/settings; input and stop remain reachable at short
height; dangerous actions never gain an implicit approval.
Non-goals: runtime redesign, new permission model, copying Codex assets, release.

## Personas and jobs
Enterprise change manager assembles sourced material across websites; developer
connects requirements/code/tests and optionally uses a terminal; everyday user
reads and acts on the current page. Each needs a quiet primary conversation and
clear separation of supporting configuration from execution.

## Information architecture
One responsive conversation workspace. At wide width, a quiet left navigation
shows new conversation, recent conversations and supporting resources. At narrow
width, navigation opens through the text-labeled header control 导航 as an in-flow, nonmodal disclosure (maximum28dvh, independently scrollable); primary conversation keeps full
width. Existing full history preserves search, folders, trash and bulk actions.
StatusRail remains the single conversation header: 导航 (narrow only), task title, existing popout/history/status/more. New conversation is owned by WorkspaceNavigation; no second new-thread control in the header. Recent rows are a projection of the existing store, while full history preserves its original owner. Conversation header shows task title (existing title resolver, 新对话 fallback); page/context and pending confirmation stay
in the existing FocusBand. Knowledge/scenes/skills/MCP/apps/meetings use existing
ContextPanelHost. The host is already vertically stacked, not a fixed-width side column: preserve that safe layout, cap it to36dvh (28dvh below560px height), and close supporting panels before opening configuration. Do not overlay pending confirmation. Settings is one named dialog with grouped sections.
No duplicated data loader, thread cache, Agent or confirmation center.

## Design principles
One dominant action per area. Progressive disclosure keeps tools/details on
demand; pending confirmation and stop stay visible. Text labels explain navigation.
Layout changes never change trust policy. Confirmation modifications are limited to shared surface colors, type, spacing and focus visibility; component handlers, button order/roles, initial focus, timeout, whitelist and auto-approve copy/defaults stay unchanged. Decision-critical evidence remains at least as visible as baseline. FocusBand confirmation/stop priority remains authoritative, with no second sticky header. Cockpit is in shared visual-token scope; confirmation DOM/handlers remain byte-unchanged. Small screens are a first-class surface.

## Visual language
Keep shared `sidepanel/ui/tokens.ts` the only new React color-value owner. Companion HTML constants mirror the palette without a new bundling dependency; their non-style source stays unchanged. Neutral
surfaces and subtle borders, readable secondary text; charcoal primary composer
action, indigo links/focus. Font system sans; body14–15, chrome12–13, headings
15–24. Spacing4/8/12/16/24/32; rounded controls8, cards12, composer20.
Flat navigation, quiet user bubble, unboxed assistant prose, restrained shadows
for floating surfaces only. Existing SVG icons; no added font/network assets.
Respect reduced motion and use short feedback transitions.

## Components
Responsive WorkspaceNavigation plus existing StatusRail/ThreadList; shared
Workspace styles, tokens and Modal. Conversation/readable-width wrappers,
ComposerDock, settings sections, tool disclosure cards, ContextPanelHost and
terminal adopt the same spacing and hierarchy. New classes are explicit, scoped,
and do not infer semantic roles from arbitrary inline-style selectors.

## Accessibility
Target WCAG 2.2 AA practices: text contrast at least4.5:1 for newly styled ordinary text, non-color risk labels, visible
focus, semantic buttons, keyboard Enter/Space, Escape and focus return for
drawers/dialogs, no nested interactive elements. Essential controls at least32px
and primary actions36px; preserve live status and destructive confirmation copy.
Do not claim formal conformance certification from automated testing.

## Responsive behavior
320–759px: full-width chat, nonmodal navigation disclosure, narrow dialogs and no fixed wide
columns. At760px+: persistent220px navigation, central conversation max780px;
wide settings use bounded centered dialog. Short screens scroll the content,
not the entire composer; supporting panel has viewport-relative height cap (min36dvh/360px, or28dvh below560px). Only message space may shrink; if confirmation competes, supporting context must yield.
Browser zoom and long titles/URLs must wrap or truncate without hiding actions.

## Interaction states
Empty state: a short invitation and useful action suggestions; suggestions fill
input, never send. Loading/streaming keeps stop; errors show recovery near source;
offline retains explicit reconnect. Selected navigation uses text plus background.
Confirmation remains distinct from normal tool success; disconnection does not
invent completion. Details expand deliberately without dumping raw JSON first.

## Content voice
Chinese product chrome, clear verbs, short labels. Prefer 对话/知识/场景/设置.
Technical detail belongs inside relevant settings or expanded evidence. Never
relabel an unverified report as approval, a process exit as task success, or a
permission setting as mere appearance.

## Implementation constraints
React18/Plasmo, inline styles plus scoped CSS, existing token owner and icons.
No new production dependency. Real component browser harness with synthetic
transport for wide/narrow/short layouts including759/760 breakpoints and200% equivalent CSS-viewport reflow, keyboard, message/tool/confirmation and
settings flows; production build, full suites and external dual reviews.
Native Swift/Windows platform chrome cannot be certified by the browser harness;
shared web surfaces are verified here, native surfaces remain separately tracked.

## Open questions
- [ ] #469: native host-window visuals on Windows require platform validation;
  owner maintainers. No claim of native cross-platform pixel acceptance.
- [ ] User can refine density after using the shipped redesign; current default
  assumes readable enterprise work rather than dense diagnostics.
