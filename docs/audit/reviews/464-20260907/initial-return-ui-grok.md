I'll read only the specified review file and follow its independent-review instructions.**Checkpoint return-ui (#466/#467)** — Chat-bound terminal, copy-only prompt, confirmed JSON import, identity/file/line/context checks, handback into the originating thread.

**Trajectory:** `reportSchema` / `checkReport` / `reviewPrompt` plus citation checks; Chat “在终端审阅并回传”; tab URL binding; `review_prompt` on `terminal.opened`; paste + confirm; `code_review.handback.message` → `ADD_MESSAGE`. Prompt is display/copy only (not `terminal.input`). Gaps stay honest (`EXTERNAL_ASSESSMENT_NOT_INDEPENDENTLY_VERIFIED`, partial, missing files/kinds). `diff_hash === null` skips line proof (Agent-only, schema-bound, unverified). Mapping `assessment` is stripped before `canonicalRequest`, so job refs stay immutable. Tab retarget and no-id errors are tested. Builds/tests cited in the brief are not re-run here.

**Defects**

1. **Post-open `terminal.error` is treated as a report problem.** After `opened`, every error only sets `reportStatus` and `submitting`; status stays `running`. SW posts the same `terminal.error` on `wsSend !== true` (disconnect). Submit failures and a dead WS therefore leave a live-looking PTY and an enabled submit button. `code` is ignored. Pre-open errors correctly go to `error`.

2. **Client wire contract is not the protocol the UI speaks.** `TerminalClientFrame` has no `review_id` on open and no `terminal.review.submit`. The tab sends both; SW forwards raw `terminal.*` with no parse/fail-closed. Server parse covers `review_prompt` / `review.received` only. Tests never exercise submit, prompt delivery, or handback.

3. **`attachTerminalPort` never returns `null`.** Comment/spec §5: second port rejected. Implementation always returns a relay. Exclusion is only `openOrFocusEmbeddedTerminal` (one extension tab URL). A second Port (duplicate tab, missed `tabs.query` URL) still relays.

4. **Readonly-plan is not reflected in UI.** The button is on any `code_review_create` / `code_review_read` card with a `review_id`. Import is a mutation. If companion does not deny it, this violates readonly-plan; even if it does, the control is a false affordance.

5. **`user_gesture: true` on `terminal.open` is issued from `useEffect`,** after an async tab create, not in the Chat click turn. Submit is a real click. If companion treats open’s flag as confirmation, the review-bound PTY skips a live gesture.

6. **This dump has no tests for `checkReport`, `reviewPrompt`, citation throws, or handback.** Core receive/persist/idempotent receipt/PTY-kill/auth-panel/scope injection are contracts only, not shown.

Rename diffs put both `old_path` and `new_path` in `paths`, so a review that lists only the new path always gets `CODE_REPORT_FILES_MISSING` (gap, not throw).

**VERDICT: REQUEST CHANGES.** Do not treat return-ui as closed until (1) post-open errors are split by `code` (disconnect/session vs import reject), (2) client wire + SW validate `review_id` / `terminal.review.submit`, (3) second-PTY reject matches the comment or the comment is removed, (4) import is gated or clearly companion-denied under readonly-plan. Identity/citation checks and copy-only prompt are directionally right; they are not enough with the error-state and wire holes.
