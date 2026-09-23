I'll re-read commit `da467062` only and check those five regressions, without editing anything.The commit is the branch tip. I'll read the diff against the five regression checks only.The diff is small. I'll read the surrounding admission, launch-spec, and focus-policy code to see whether those five checks still hold.All five regression checks hold on `da467062`. No files were edited.

1. **Non-outbound confirms stay unlabeled.** `confirmToolName` is `[Outbound] ${toolName}` only when `isOutboundMcpCall` is true; otherwise it is the bare tool name. The exfil frame in `companion-http.ts` is outbound-only. A plain `navigate` confirm does not set `outboundChannel` and stays `stay_background`.

2. **Tray and WS share the label.** In `l2-admission.ts`, both the tray request and `securityConfirmations.request` pass `confirmToolName`. There is no second bare `toolName` on either confirm payload.

3. **`%LOCALAPPDATA%` warning is content-based.** `unexpandedLocalAppDataWarning` returns non-null only if `command` or `args` contain that literal. Darwin (`/Applications/CMspark.app/...`) and Linux (`cmspark-agent`) specs do not, and the tests assert `null`. The Windows copy snippet still includes the CLI hint and adds the warning only when `hostOs === "win"`.

4. **No auto-approve and no timeout change.** Outbound still forces `skipConfirmation = false`. The exfil request still sets `autoConfirmEligible: false`. Tray timeout is still `DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS` (45000). The “约 45 秒” sentence is copy only. The “后续同类外泄不再逐次询问” line describes the existing post-approval session cache, not a new skip.

5. **Cockpit exception is prefix-only.** `outboundChannel` is set only when `tool_name` is a string and `startsWith("[Outbound]")`. It is not a substring match, not `code_preview`, and not risk level. `background/index.ts` passes that event straight into `decideCockpitFocus`.

VERDICT: APPROVE
