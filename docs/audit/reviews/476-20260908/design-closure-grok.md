Design-only review of the frozen #476 packet (identity, confirmation sequencing, acceptance). No repo access; no other reports.

IDENTITY
The fail-closed idea is right: a distinct desktop channel, not `surface:"desktop"` on the tray/overlay origin; allowlisted methods; payload checks; source-bound events; overlay mutation denial kept; no silent global ACL wipe; no `mcp.toggle_server` as a management shortcut.

It is not implementable as written.

1. Identity is named, not issued. There is no mint/bind/rotate/revoke, no connection- vs request-level check, and no mapping of window/process to channel. Unknown identity fails closed, but there is no positive enrollment.

2. Compact summon (360x420, overlay ACL) and workspace (1040x760, management) can share the current Chromium app-mode process. Identity must not be inferred from size or restored nav. The packet never says whether those are two hosts, two origins, or one host with an explicit surface token. Resizing or un-hiding nav must not promote overlay to desktop.

3. Three clients, one store: overlay WS, menu-bar HTTP/SSE summoner client, desktop workspace. Menu-bar is not classified (overlay-restricted vs desktop-privileged vs third). Same authenticated summoner client is a privilege-sharing risk.

4. Tray “omitted clients” must be labeled before compatibility changes — stated, but not a slice gate with a fail-closed matrix.

CONFIRMATION SEQUENCING
Corrections require: shell → desktop identity + confirmation → management → new PTY/ACP execution → browser task policy → native/package. Display of prior output may precede confirmation; new execution may not. Reuse one confirmation manager; bind connection + thread + action/challenge + expiry; cancel on disconnect; reject wrong-client / expired / duplicate / changed-payload; never take an extension confirmation id without origin binding; visibility is not permission.

The numbered slices contradict that:

1. Shell
2. Desktop management transport (identity AND MCP CRUD/connect, skills/knowledge management)
3. Local work (new terminal/agent execution)
4. Desktop confirmation
5. Browser
6. Native packaging

That list is the only numbered work breakdown. It puts management and new execution before confirmation, and bundles identity with CRUD/connect in slice 2. Stdio spawn and skills install still need confirmation; slice 2 would ship them without the confirmation slice.

“Fix dead MCP” in slice 1 is safe only as remove/disable. Any live toggle, even “read-only looking,” on overlay WS/HTTP is a bypass. That is not an explicit slice-1 acceptance test.

Shell-first is fine. Privileged work is not sequenced until the numbered list is rewritten to match the corrections: identity and confirmation as a hard gate; management after; execution after; no CRUD/connect in the identity slice.

ACCEPTANCE GAPS
- Close rule vs slice 6: corrections require native WKWebView/WebView2 on supported macOS/Windows before #476 can close; Chromium app-mode is #477-transitional only. Slice 6 still says “if native webview is required.” That “if” is enough to close on the isolated Chromium UI profile, which the evidence already shows is not the user Chrome profile and is not native hosting.
- Slice 1 correctly cannot close #476; nothing equivalently blocks slice 2/3 without confirmation evidence.
- Browser policy is in the right place relative to #477 (connection/opening only). Unsupported background must report unsupported or disclose required foreground — not silent foreground. That belongs in slice 5 evidence, not as a host-window side effect.
- Negative tests (wrong identity, overlay mutation, stale list, cross-thread events, replayed/web confirmation, stop with nav open) are named but not bound to slices as exit criteria.
- ACP/PTY reuse without a mandatory coding Agent is stated; “local agent unavailable” must be a real recoverable state in the execution slice, not a shell placeholder.
- Config-write/redaction review before forms is a process note, not a method-level schema/redaction table. UI drafts ≠ persisted state is correct and must be tested.

The corrections are the right design. The frozen packet still ships the old slice order and a conditional native-host close. That is not freeze-quality for privileged desktop work.

VERDICT: REJECT
