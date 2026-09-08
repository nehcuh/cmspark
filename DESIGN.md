# Design

## Source of truth
Active · 2026-09-08 · GitHub #469 / #471. This file owns product-wide UI/UX direction.
`docs/DESIGN.md` retains detailed capability and safety contracts; this revision
supersedes its consumer-mascot-first layout, tiny chrome and narrow-only shell.
Evidence: Sidepanel App, StatusRail, ThreadList, ChatView, ComposerDock,
ContextPanelHost, SettingsSlideout, shared tokens/Modal, Cockpit, graphs, terminal, capture and standalone web settings.
No current Codex screenshot was accessed: the reference is the user's stated
preference for quiet, spacious hierarchy, not a pixel-matching target.

## Brand
Calm, precise, capable. CMspark remains its own identity. Neutral paper and ink,
text-led summoner without a decorative mark, restrained indigo links/focus, semantic risk colors.
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
StatusRail remains the single conversation header: 导航 (narrow only), task title, existing popout/history/status/more. New conversation uses the existing createBlankThread owner: WorkspaceNavigation on wide screens and a persistent header + below760px (#473). Recent rows are a projection of the existing store, while full history preserves its original owner. Conversation header shows task title (existing title resolver, 新对话 fallback); page/context and pending confirmation stay
in the existing FocusBand. Knowledge/scenes/skills/MCP/apps/meetings use existing
ContextPanelHost. The host is already vertically stacked, not a fixed-width side column: preserve that safe layout, cap it to36dvh (28dvh below560px height), and close supporting panels before opening configuration. Do not overlay pending confirmation. Settings is one named dialog with category pages; the #471 refinement below owns its navigation.
No duplicated data loader, thread cache, Agent or confirmation center.

## Design principles
One dominant action per area. Progressive disclosure keeps tools/details on
demand; pending confirmation and stop stay visible. Text labels explain navigation.
Layout changes never change trust policy. Confirmation modifications are limited to shared surface colors, type, spacing and focus visibility; component handlers, button order/roles, initial focus, timeout, whitelist and auto-approve copy/defaults stay unchanged. Decision-critical evidence remains at least as visible as baseline. FocusBand confirmation/stop priority remains authoritative, with no second sticky header. Cockpit is in shared visual-token scope; confirmation DOM/handlers remain byte-unchanged. Small screens are a first-class surface.

## Visual language
Keep shared `sidepanel/ui/tokens.ts` the only new React color-value owner. Companion HTML constants mirror the palette without a new bundling dependency; their existing transport/permission behavior stays unchanged; #471 updates semantic composer markup and empty-state copy. Neutral
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

## 2026-09-08 refinement · #471

The summoner is a lightweight conversation surface using the same neutral chat
hierarchy and full-width composer above its actions. Remove every decorative 山
mark from initial and dynamically recreated empty states; no replacement hero.
Settings uses category navigation and one visible content page (wide left rail,
narrow select), not navigation chips above a giant accordion. Split voice/input
and file/knowledge from model configuration. Keep all pages mounted so drafts
and safety forms survive switching; retain stable deep-link IDs and save semantics.
Pairing/elevated-trust status remains visible across categories. Root specification:
`docs/superpowers/plans/2026-09-08-summoner-settings-redesign.md`.

## 2026-09-08 conversation management · #473

Keep the approved chat visual. Narrow headers retain a + button and named conversation management; wide navigation exposes management beside recent conversations. A single ThreadList owns time/tags/manual groups/derived AI groups and visible AI extraction, rules cleanup, graph and trash entry points. Manual labels persist separately from AI digest. AI grouping is a view of the first extracted AI label and can change on re-extraction, never rewriting manual folders. Replies must confirm the matching persisted update and its fields before showing save success. The nonmodal manager stays above the composer and yields immediately to pending confirmations; it never intercepts Stop. Narrow rows put actions below readable titles. See #473 plan and tests.

## Brand assets and tray status (#474)

The extension and macOS app use a static connection-and-spark mark. The tray alone encodes Companion process state: green solid center for running, red hollow center for stopped, amber for unknown. No glow or texture. Geometry and sRGB colors are pinned in `scripts/lib/brand-icon.mjs`; Swift follows the same 24-unit contract and is compared by offscreen render. The app asset uses a dark rounded tile; the extension/tray use transparent backgrounds. Existing chat decorative illustrations remain unchanged.

Tray title is empty and the redundant menu header is removed. Tooltip, native accessibility label and status details retain words; unknown is explicitly “状态未知”. WebSocket connectivity does not change the process-state meaning. Generated 16–32px and Retina assets require visual verification on light/dark backgrounds. See the #474 plan for coordinates, colors and rendering gates.

## 2026-09-08 desktop workspace · #476 / #477

#476 supersedes the lightweight-only product goal for the summoner. The complete
workbench requires explicit desktop management identity and confirmations before
sensitive management/terminal actions. #477 is the first UI slice only: a1040x760
workspace with220px text navigation, compact360x420 user-requested window, visible
resources and history search. At widths below760px navigation is an in-flow
bounded disclosure; composer/stop stay outside it. Native hosting, MCP CRUD,
terminal and complete knowledge/skill editing remain tracked gaps, never claimed
from restored resource lists. Do not broaden the summoner ACL for this slice.
Chrome connects the user's existing browser; launch visibility is not a per-task
background automation guarantee. See the #476 plan for acceptance dependencies.
