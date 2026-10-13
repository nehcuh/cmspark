# ITCra enterprise browser research — #618

Status: Research complete; user selected extension of REST/grant on 2026-10-13. Implementation proceeds under issue #618 and ADR-029. No production grants or live configuration changes.

Source: `/Users/huchen/Projects/ITCra/docs/CMSPARK-ADAPTATION-HANDOFF.md` v1.1, SHA256 `52010d7a4ba59134e33263b271040e10a762157b177b3073185b4f78adb068b7`. Research CMspark base `c570cb80c5799057e067ae0b55e6a3e4548288c3` (Office PR #617). Handoff original source baseline3705f5d/install0.6.13 is not the current source/build; new feature discovery and minimum compatible versions are required.

## Observed current implementation

- `/outbound-mcp/v1/invoke` authenticates specific hashed `cmg_` credentials with caller/profile binding. Existing default/interact profile tools already contain the browser tools needed; enterprise scope should narrow these capabilities, not expand general outbound profiles (#228 freeze).
- `outbound-grants.ts`: no enterprise identity, browser instance, per-path navigation/export/login scopes, action rules or approval issuer binding. Existing context permissions serve business evidence, not browser SSO/human approvals.
- `facade.ts`/`companion-http.ts`: authenticated grant-specific allow_page_export plus process-local caller disclosure confirmation. Operator8h confirmation remains a real independent gate.
- `ws/lifecycle.ts:pickAuthenticatedClientWs/ensureOutboundToolRunnerWired`: chooses the first authenticated Chrome-extension socket and one global runner; there is no enterprise browser-instance selector. New session labels alone cannot provide multi-user isolation.
- `server.ts:createToolExecutor`: trusted invocation options, rather than user-supplied params, carry outbound authority. Admission sequence covers multi-agent pregate, cookie, browser-download, L2, URL and execution forwarding. Browser enterprise authority must follow the same trusted-context pattern through all actual gates.
- `tool/url-cookie-admission.ts`: outbound deliberately does not use global God-mode/automatic URL confirmation settings. `tool/l2-admission.ts` and SecurityConfirmationManager remain independent authority gates.
- `outbound-mcp/dual-entry.ts`: leases currently use caller-level `outbound_mcp:<caller>` plus raw global tab IDs. Enterprise instance/session/identity ownership must be authenticated and not borrow a sibling grant's tabs.
- `outbound-mcp/context-session.ts`: a useful opaque handle pattern, but a30min business-context handle is not a browser login/operation session. No SSO readiness adapter, operation challenge, human approval verification or durable waiting state exists.
- BrowserBridge screenshot protects against capturing the wrong active tab after CDP failure. An enterprise session must retain this safety and improve reliability in an isolated instance/window; activating another user's tab is unacceptable.
- `capability/enterprise-session-trust.ts` governs interactive shell/netsec session trust, unrelated to enterprise browser service policy; reuse would widen the wrong authority.
- ITCra adapter currently wraps four REST tools and process-memory tab tracking. Its deployment token/shared browser POC, manual login panel, missing human approval/RBAC/checkpoint restoration require ITCra-owned companion changes. The provided ITCra directory is not a Git checkout. No edits were made there.

## Fixed acceptance obligations

R1 authorized normal actions produce zero local/ITCra approval prompts; R2 correct-user no-store SSO screenshots and same-session continuation; R3 dangerous actions execute zero times before separate trusted human authorization and exactly once afterward; R4 stable contract plus recorded real producer payloads; R5 isolation, offline delivery and audited provenance.

P0 required A1–A11,A13–A24; phase=all adds A12. Fail/missing/skipped required cases must fail overall acceptance. Real enterprise SSO cannot be replaced by mock/public-page screenshots. Full delivery requires ITCra-side UI/RBAC/resume integration and enterprise test identities/site configuration; current evidence establishes source behavior, not joint acceptance.

## Design questions already presented

1. Extend existing authenticated REST/grant with administrator-owned enterprise policy, isolated browser identity, controlled sessions and separate signed single-use human authority (recommended).
2. Deploy an independent enterprise browser service, with separate operational ownership and interface migration.

The user selected approach 1. Implementation spec/plan follow that choice.

## Scope constraints for either implementation

Keep old grant/desktop HITL defaults. Do not authorize by caller_id alone, agent approved=true, ordinary execution grant, HTTP method, tool name or origin only. Canonical path boundaries and actual target/navigation revision matter. Normal versus dangerous classification must use trusted site rules/actual element semantics; unknown effects fail closed. No shell/evaluate/Cookie or password export. No secrets/login images/tokens in model input, audit or fixtures. Revalidate expiry/revocation before execution and before output. Durable idempotence/cancellation must distinguish an async accepted response or ordinary poll end from disconnection while awaiting execution. Restart restores waiting state or explicitly terminates it. T4 requires concrete human boundary approval and bake-off as well as machine/adversary/Pi/Kimi/CI gates.

## Prerequisites completed after research

Office #617, subtask navigation #620 and cooperation recovery #622 passed their machine/adversary/Pi/Kimi/required CI gates and landed. Next implementation base is main e44af42f0f3999f23306e41159edb8b12e3dbdff. #622 Windows first attempt hit unchanged native PowerShell ownership-query timeouts; one fresh failed-job retry passed at original limits; diagnostic follow-up #623 retains the uncertainty. Existing installed builds were not replaced.

This research is committed on codex/itcra-enterprise-browser-618. Source implementation and isolated verification follow; joint acceptance and production policy issuance are separate evidence and actions.

## Live entry observation after user network steering — 2026-10-13

Authorized read-only fresh Chrome probe: HTTPS and HTTP `home.cmschina.com.cn` each reached the main-frame `https://sso.cmschina.com.cn/login.aspx` with status200 on retry. Initial probes had returned ERR_EMPTY_RESPONSE; the successful retry supersedes entry-connectivity failure, not a completed authenticated acceptance. Headed browser navigation and separate headless DOM-structure probe were both used. Visible iframe count0, form1, text inputs4, password inputs0, canvas0; login structures `#loginBody` (body), `#qrcode` (div), `#btnLogin` (input) each visible/unique. One exact visible “扫码登录” label. This observation qualifies candidate login selectors only; no ready marker or actual principal/post-login state was observed.

Captured only bounded marker counts/known host groups. No page-body text, QR/image pixels or sources, credential values, tickets/query strings, browser userdata or production grant changes. The real ITCra authenticated presentation/signing UI and complete A1–A24 driver remain required. The supplied enterprise site is reachable in the current local network; no bypass of certificate validation or user profile was used.
