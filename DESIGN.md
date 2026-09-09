# Design

## Source of truth
Active · 2026-09-09 · GitHub [#481](https://github.com/nehcuh/cmspark/issues/481), [#488](https://github.com/nehcuh/cmspark/issues/488), [#490](https://github.com/nehcuh/cmspark/issues/490).
This is the current UI/UX contract for the extension workspace, summoner, settings,
code panel, terminal, confirmation cockpit, meetings, graphs and tray. It consolidates
#469 / #471 / #473 / #474 / #476 / #477 instead of appending competing layout rules.
`docs/DESIGN.md` retains capability/safety contracts; its older mascot-first,
tiny-chrome and narrow-only presentation is superseded.

Evidence: [workspace audit](docs/audit/2026-09-08-workspace-ux-audit.md).
Scope and proposal: [current repairs and projects](docs/superpowers/plans/2026-09-08-workspace-projects-ux.md).
Native prerequisites: [#476 plan](docs/superpowers/plans/2026-09-08-desktop-workbench.md).
The user prefers Codex's quiet hierarchy. No current Codex screenshot was inspected
for this revision; this is not a pixel-matching or feature-parity claim.

## Brand
Calm, precise, capable. Neutral paper/ink, restrained indigo links/focus, semantic
risk colors. Avoid gradients, decorative counters, dense icon ribbons and large
mascots. Do not reintroduce the decorative 山 mark in summoner empty states.
The static app/extension mark is owned by `scripts/lib/brand-icon.mjs`. The tray
alone represents Companion process state: green solid center running, red hollow
stopped, amber unknown. No tray title or redundant menu header; tooltip and native
accessibility retain words. WebSocket connectivity is separate. Keep macOS,
Windows and extension assets aligned.

## Product goals
Make conversation, prior work and the next action easy to find. Input, recording
feedback, stop and pending confirmation remain reachable. A coding run belongs to
its originating conversation; changing views does not transfer ownership.
The complete #476 desktop workbench supports work without Codex, with optional
programming agents and existing Chrome for web tasks. This is a product goal;
the current Chromium summoner is transitional, not that complete native product.

Current #481 delivery: voice reliability/feedback (#482), coding-session scope
(#483), summoner manual tags/groups using existing metadata, and conversation-first
navigation. Project entities/defaults, a global activity center, merged code/terminal
workspace and native management are future work. No copied Codex assets, mandatory
external agent, blanket permission or automatic live-configuration migration.

## Personas and jobs
Change managers assemble sourced requirements, versions, artifacts, architecture,
runtime, code and test evidence. Developers continue across conversations and
repositories with optional programming agents. Others read websites, dictate a
message or record meetings. Ordinary conversations require no repository or project.

## Information architecture
Current navigation order: new conversation; search/recent conversations with
visible management; supporting resources; settings where actually available.
Use the same order on both surfaces. Preserve existing capability entries.
Name browser tabs “浏览器标签页”; conversation categories remain “标签 / 分组”.
Wide screens have left navigation and one main conversation. Narrow navigation is
a text-triggered, nonmodal, in-flow disclosure. StatusRail is the single header:
title, narrow navigation/new-conversation controls, existing popout/management/
status/more. FocusBand owns priority feedback; its coding slot shows only the
current conversation's session. A background event cannot open another thread's panel.

ThreadList owns extension history, time/tags/manual/AI views, trash and bulk actions.
Recent navigation projects the same store. Summoner uses persisted `user_tags` and
`topic_folder`, not a second grouping store. AI grouping derives from extracted tags
and never rewrites manual grouping. Keep AI extraction, cleanup and graph entries.
Full selection uses the current search/tag/trash view and excludes busy threads.
Cleanup suggestions own a separate selection. An empty selection never expands
into a delete-all action. Confirmations show actual targets; only server-confirmed
results update the list. Partial failures stay visible and unknown outcomes require
refresh before retry. Empty cleanup requires server-side content revalidation.
The entire history panel scrolls on short screens; its list cannot collapse to zero.
Meeting close and navigation wait for final transcript persistence and end receipt;
failures retain the panel with a retry action.
Knowledge graph (#490) has a real canvas lifecycle tied to asynchronous data,
an always available searchable document list, explicit fit/zoom/refresh, and
selected-document relations. The list and notices occupy layout space rather
than covering the canvas. Canvas labels are readable by default; collision
suppression never removes list entries. Selection explores in place; opening
the existing knowledge panel is explicit. Isolated documents stay visible.
Color is a grouping aid; solid similarity edges and dashed AI relations retain
their provenance. Search never triggers AI; refresh preserves the user's existing
naming preference (off by default, enabled preference permits existing on-demand
label completion). Organization still requires an explicit action. Existing AI
naming, organization, lock/unlock and relation reasons remain discoverable.
Below 760px, graph and browser stack in a scrollable page; zero documents,
disconnected transport and loading failures have distinct recovery copy.
Existing resource panels use ContextPanelHost above the composer; summoner resource
attachments retain their current surface until native management lands. Label
“used in this conversation” separately from global configuration. Read-only lists
must not imply edit/install/connect capability. Settings uses one named dialog,
category pages (wide rail/narrow select), stable deep links and mounted forms that
preserve drafts. Pairing/elevated trust remains visible; independent saves stay explicit.

Future proposal: optional Project → Conversation → Execution records. Project is
a durable context with an optional local repository, not a renamed manual folder.
Conversations may remain outside projects. No project UI ships before its real model.

## Design principles
One dominant action per area; supporting controls on demand. Preserve existing
data/execution/confirmation owners. Fix state scope before adding task controls.
Keep completed code results reachable in their conversation; an old run cannot seize
a new conversation's header. Current scope repair does not delete results to simplify UI.
Layout does not grant trust. Confirmation handlers, order/roles, initial focus,
timeout, whitelist, auto-approve defaults and critical evidence retain their contracts.
FocusBand's confirmation/stop priority is authoritative. Cockpit confirmation
DOM/handlers are outside this visual batch. Resizing never grants desktop privileges.

## Visual language
`chrome-extension/src/sidepanel/ui/tokens.ts` owns new React colors; Companion HTML
mirrors the palette without a new bundler. Neutral surfaces, subtle borders,
readable secondary text, charcoal primary composer action and indigo focus.
System sans; body 14–15px, chrome 12–13px, headings 15–24px. Spacing 4/8/12/16/24/32px;
radii 8px controls, 12px cards, 20px composer. Quiet user bubbles, unboxed assistant
prose, shadows only for floating surfaces. Existing SVG icons; no network/font assets.
Terminal uses existing dark tokens. Respect reduced motion.

## Components
Reuse WorkspaceFrame/WorkspaceNavigation, StatusRail, ThreadList/metadata editor,
Modal/tokens, ChatView, ComposerDock, ContextPanelHost and settings pages. Session
selection belongs in shared typed selectors/reducers, not divergent component filters.
Voice state explains preparing/listening/processing/failure next to the mic.
Use explicit scoped classes, not arbitrary inline-style selectors. Share navigation,
copy and data projections with transport adapters when practical; no forced full
React/native rewrite, duplicated thread cache, Agent or confirmation manager.

## Accessibility
Target WCAG 2.2 AA practices: new ordinary text contrast at least 4.5:1, visible
focus, semantic buttons, text alongside risk colors, Enter/Space, Escape and focus
return, no nested interactive elements. Essential controls at least 32px, primary
36px. Preserve live status/destructive copy. Voice animation supplements text and
respects reduced motion. Automated checks are not a conformance certification.

## Responsive behavior
320–759px: full-width conversation, no fixed wide columns; nonmodal navigation
bounded to 36dvh (28dvh below 560px height), independently scrollable. At 760px+:
persistent 220px navigation; conversation reading width up to 780px. ContextPanelHost
is bounded to min(36dvh, 360px), or 28dvh at short height, and yields to confirmation.
Wide settings use a bounded centered dialog. Only message/supporting content shrinks;
composer/stop remain reachable. Long titles wrap/truncate without hiding actions.
Verify 320/390/759/760/1040/1440px widths, 420/480px heights and 200% equivalent reflow.
Summoner default 1040×760, explicit compact 360×420; clamp and retain user resizing.

## Interaction states

Meeting workflow (#492): arrange recording/imported audio, original transcript,
reference notes and minutes as distinct user materials. Word/Markdown/text notes
never replace the transcript. Show raw recognition immediately; optional AI
correction suggestions cannot delay it. Primary stop action explicitly generates
minutes; stop-only and close retain their local-only intent. Confirm current
material saves before generation; retain drafts on failure and label older minutes
as needing an update. Keep corrected transcript and source excerpts reviewable,
with note-only supplements and conflicts separate from audio evidence. Preserve
speaker tools, templates and export under clear, discoverable controls.

Empty suggestions fill, never send. Loading shows the pending action at its source,
never a silent mic. Listening begins only when capture is ready; partial recognition
is distinct from final text. Processing stays visible after stop; failure keeps drafts.
Do not promise hardware-independent transcription latency: record cold/warm setup,
first partial and finalization separately. Save success requires matching persisted
fields/identity, not transport ACK. Switching threads cannot redirect an in-flight
save, transcript, report, approval or session event. Offline offers recovery without
invented completion. Process exit, report import and review approval are distinct.

## Content voice
Chinese product chrome, clear verbs, short labels. Use 对话, 项目 (real entity only),
标签, 分组, 浏览器标签页, 知识, 场景, 设置. Code work may become “代码与终端”;
ACP/PTY details belong inside technical disclosure. Errors point to current settings
labels (“输入与语音”), not stale “设置 → 听写” navigation.

## Implementation constraints
React 18/Plasmo, existing styles/tokens; no new production dependency for this batch.
#481 narrowly expands the authenticated overlay's payload ACL for existing
`thread.update`: only alias/user_tags/topic_folder, using the shared HTTP/WS metadata
patch validator. Unknown fields (including alias plus config) reject the whole patch.
This is an ACL change and a T3 review focus, not an unchanged-policy claim. It
supersedes only #476's scheduling of these low-risk metadata fields; workspace,
trust/config, MCP writes, terminal, install/import and approval remain denied.
Native identity and native confirmation remain prerequisites for privileged #476
work. Current Chrome actions connect/open the existing browser; they are not a
per-operation background guarantee. No profile copying or silent foreground fallback.
Issue-first, owning machine/contract tests, real-render synthetic UI checks, build
and actual independent Grok + DeepSeek gates. Native host behavior, signatures,
microphone performance and Windows runtime need separate evidence. Reports distinguish
current delivery, reviewed design and future capabilities.

## Open questions
- [ ] Project proposal: maintainers to validate optional single-directory defaults,
  migration and storage in a subsequent implementation Issue; no shipped schema here.
- [ ] Native #476 management, Windows host visuals and task-level Chrome visibility
  remain owned by their slices; current repairs cannot close them.
- [ ] Voice #482: measure installed engine/model cold/warm timing before claiming
  the user's performance issue resolved.
- [ ] Resource/settings/meeting/graph improvements in the audit need separately
  tracked changes and surface-specific acceptance; an audit is not implementation.
