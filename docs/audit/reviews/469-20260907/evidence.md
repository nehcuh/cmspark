# #469 UI/UX evidence

Base: `8656df94ce1c4b53766acf62e2fe037c41b975f7`. Branch: `codex/ui-workspace-redesign`.
Blast tier T3 (conservative: presentation intersects confirmation and shell reachability); existing confirmation/Stop remains safety-critical and was separately hit-tested. No permission defaults, confirmation handlers, tool routes, API contracts or installed app changed. No production dependency or version change.

## Observable outcome

- At760px+: visible220px navigation; conversation/composer bounded780px.
- At320/390/759px: full-width input, no horizontal page overflow, named nonmodal navigation.
- At320×480: opening navigation alongside pending confirmation or a running task leaves Allow/Reject/Stop hit-testable; no implicit confirmation frame.
- History arrows are part of native buttons; Enter opens a thread; Escape from a row closes history without closing the existing context panel.
- Settings category opens its real section and focuses it; narrow settings is bottom-aligned. Opening settings closes supporting context.
- Tool details are keyboard operable; long text does not overflow page; offline reconnect and disabled composer remain.
- Coding panel tracks measured StatusRail height at wide/narrow sizes.
- Terminal retains explicit report submission and sends no generated terminal command merely from rendering/copying.

## Machine evidence

Commands run with Node22.23.2; all listed completed exit0:

- `npm --prefix chrome-extension run build`
- `npm --prefix chrome-extension test`:1281 pass,0 fail.
- `npm --prefix companion run build`
- `npm --prefix companion test`: primary suite4996 pass,23 skipped,0 fail; separate20 pass,0 fail.
- `uv run --no-project --with playwright python chrome-extension/scripts/test-workspace-ui.py`
- `uv run --no-project --with playwright python chrome-extension/scripts/test-terminal-review-ui.py`
- `uv run --no-project --with playwright python companion/scripts/test-web-surfaces-ui.py`
- Additional real Cockpit idle render with synthetic transport at1000×760: no pageerror/overflow.

Browser harness uses real components with synthetic Chrome/Companion transport, no live enterprise data. Terminal uses real React/xterm with recorded protocol shape and synthetic PTY. Companion HTML test removes scripts and blocks network: presentation-only, plus non-style source equality against base. Graph changes are surface tokens only, covered by build/full regression; no new graph algorithm acceptance claim.200% equivalent CSS viewport is reflow evidence, not actual browser zoom or formal accessibility certification. Swift/Windows native chrome remains platform validation work. Screenshots contain invented demonstration data only.

## Independent gates

User-authorized combination: Grok4.6 and DeepSeekV4Pro. DeepSeek uses Claude CLI as transport; the returned modelUsage identifies DeepSeek, not Claude. Initial design reports had conditional MAJOR findings; design-r2 closes them. Implementation layout/interaction reports are retained, including REJECT and missing-context mistakes. Revision review closes actual blockers and rechecks previously omitted dependencies; final verdicts and manifests accompany this record when complete. No score/confidence substitutes for passing machine checks or reviewer verdict.

## Cases retained from rejected work

1. Input: short side panel with pending confirmation and navigation open.
   Failure: modal navigation covers decision/Stop controls.
   Attribution: implementation layout mistake.
   Guard: in-flow nonmodal navigation + actual elementFromPoint assertions for all actions.

2. Input: history group arrow clicked; Escape from history row while context open.
   Failure: label-only button left dead arrow; Escape bubbled to context owner.
   Attribution: implementation accessibility conversion.
   Guard: arrow inside button; scoped stopPropagation; real keyboard/context retention check.

3. Input: implementation split into reviewer packets without all dependencies.
   Failure: invented absent OPEN_SETTINGS_SECTION and absent ChatView classes; primary/overflow mistaken for capability denial.
   Attribution: review packet incompleteness plus unsupported reviewer inference.
   Guard: unified diff and actual reducer, SettingsSection, mode sets included in revision packet; require originating reviewers to close claims.
