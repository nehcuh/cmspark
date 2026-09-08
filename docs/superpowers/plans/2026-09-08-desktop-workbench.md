# Desktop workbench
GitHub: #476
Status: design under independent review; not implementation-complete.

## User outcome
CMspark is usable without Codex: a quiet conversation workspace with conversations, MCP, skills, knowledge and local work. Keep a quick summon action. For web jobs connect the user's existing Chrome; background means avoid foreground activation where supported, never headless or a different profile. Foreground explicitly shows the operation page. Existing Chrome extension remains the current authenticated browser transport, not a requirement for non-browser jobs.

## Evidence / actual gaps
- `companion/src/summoner/shell-open.ts`: 360x420 window, Chromium app-mode host with isolated UI profile. This UI profile is not the user's automated Chrome profile. There is no native WKWebView/WebView2 host here.
- `companion/src/summoner-web.ts`: nav and settings hidden, history overlays entire HUD; list-only MCP with a stale clickable toggle calling an intentionally unavailable API. Knowledge/skills only attach to current conversation, not full management.
- `companion/src/ws/summoner-acl.ts`: overlay alias-only updates, no MCP mutation/config/terminal/confirm grants. Restoring navigation cannot turn this channel into a full desktop manager.
- `companion/src/menu-bar-agent.ts`: HTTP/SSE shell dispatches through authenticated summoner client. Same Companion thread backend exists; do not create another store.
- `companion/src/summoner/client.ts`: foreground option only opens Chrome; this is not yet a per-task automation visibility policy. Silent fallback may open foreground when unsupported.
- `companion/src/message-router/handlers/mcp.ts`, `knowledge.ts`, skills, ACP and PTY runtimes are reuse candidates, subject to identity and response/event validation.

## Information architecture
Wide: 220px navigation with text labels, recent conversations, New conversation; central conversation with max780px reading column and composer aligned to it. Resources open a dedicated content region, with one clear heading, search and primary action. No icon-only vertical ribbon. Narrow: named navigation disclosure, permanent New conversation, content and stop remain reachable. Quick mode remains compact; workspace opens at a useful larger size. No mountains/mascots, gradients or fake dashboard metrics.

Navigation: 对话, 本地工作, MCP, 技能, 知识, 浏览器; 设置 at foot. Management must show loading/error/empty/save-in-progress and persisted success. Display server states from actual response fields, not `enabled` as connection health.

## Implementation slices and acceptance
1. Shell/navigation: usable wide/short layouts, visible history/search and resources, explicit read-only limitations until management slice lands. Fix dead MCP interaction. This slice alone cannot close #476.
2. Desktop management transport: separate typed local desktop identity, allowlisted methods and per-resource payload checks. Preserve overlay restrictions. Thread tags/folders, MCP CRUD/connect, skills and knowledge management share current handlers; no live configuration migration. Review config writes and secret redaction before adding forms.
3. Local work: reuse PTY and ACP; bind lifecycle and output to thread/session, local explicit terminal gestures, reconnect/stop, external review artifact return. Local agent unavailable is a recoverable state, never fabricated success.
4. Desktop confirmation: explicit origin ownership, challenge/action binding, expiry, cancel/disconnect; never replay a web approval or treat desktop visibility as permission. This is a dependency for sensitive standalone tools, not a late cosmetic step.
5. Browser: existing Chrome connection and real peer status; foreground/background task policy through actual browser adapter. No implicit remote debugging, no headless browser, no profile copying. Operations requiring visibility say so. Missing extension/peer shown with setup action.
6. Native packaging: macOS and Windows shell behavior validation; if native webview is required, implement and separately verify it before claiming browser-free hosting. UI host and web automation browser are separate concepts.

## Gates
T3. User-selected independent Grok4.6 + DeepSeekV4Pro. Frozen source/design packets, actual model verdicts, negative auth/payload/cross-thread/confirmation tests, actual rendered UI at320/390/760/1440 and short height, machine checks before implementation release review. Keep #475 icon/history delivery separate. Every slice must have linked implementation Issue/PR and concrete evidence; #476 stays open until full acceptance.

## Decisions
User confirmed existing Chrome, background or show operation page (2026-09-08). No Codex dependency. No new external services or mandatory coding Agent. No permission model bypass. Browser-free local work is an outcome requirement; current Chromium shell dependence is an explicit gap, not silently accepted as done.

## Design review corrections — before any privileged desktop implementation
- Hosting decision: native desktop hosting is required for the complete #476 browser-free local-work acceptance. Chromium app mode is explicitly transitional in #477. Do not close #476 until native hosting works on supported macOS/Windows paths; no ambiguity about a follow-on being sufficient.
- Order: shell → desktop identity + confirmation → management → new terminal/agent execution → browser task policy → native/package acceptance. Prior-output display can precede confirmation; new execution cannot.
- Desktop authentication is a distinct authenticated channel, not arbitrary `surface:"desktop"` over the tray origin. Introduce an explicit surface validator, bounded method and payload policies, source-bound event delivery. Unknown desktop identity fails closed. Audit legacy omitted tray clients and migrate with explicit tray identification before changing existing compatibility behavior; no silent global ACL removal.
- Preserve overlay HTTP MCP mutation denial in #477. Audit the older WS `mcp.toggle_server` allowlist in the desktop-identity slice; no management form may use it as a shortcut.
- Reuse existing security confirmation manager with connection + thread + action/challenge + expiry binding and cancel-on-disconnect; reject wrong-client, expired, duplicate and changed-payload responses. Never accept an extension confirmation ID in the desktop channel without the same origin binding. No second acceptance queue.
- Desktop methods must each specify request schema, actual response, event targets and redaction; deny prototype keys, unknown fields and wrong-thread resources. MCP stdio spawn retains explicit confirmation. Skills install/import retains existing preview/security gates. UI drafts do not equal persisted state.
- Browser background request when unsupported must report unsupported or explicitly disclose required foreground before activation. Slice #477 exposes connection/opening only, not task visibility control.
- Workspace default1040x760, compact360x420; responsive at320/390/760/1440 and short heights. Same conversation/data runtime. Test missing peer, denied mutation, stale asynchronous list response, stop with navigation open, reconnect and cross-thread outputs in their owning slices.
