# Read-only DOM failure isolation

GitHub: #729

Separate exactly `get_page_text`, `get_page_html`, and `wait_for` from the
interaction origin failure counter. Each family keeps the existing threshold
of four failed executions; read-only calls also keep their existing per-tool
locator threshold of two. Unknown execution failures still count. Attach freeze
continues to refuse both families, and evaluate remains an interaction.

The new read-only counter is thread/origin scoped and volatile. The existing
persisted origin snapshot remains an interaction snapshot; historical ambiguous
counts are not silently deleted or reinterpreted. Read-only failures do not
become wildcard interaction locator history. Legacy wildcard interaction bans
do not block observations. The authenticated existing origin reset clears both
runtime origin counters, preserving locator bans, attach freeze and other scopes.

Read-only refusal uses the existing recoverable `SITE_OP_BANNED` code and fixed
guidance to change pages/reading strategy or ask for the existing explicit origin
reset. Waiting or reopening the same origin does not clear the runtime counter. Neither that envelope nor its
read-only memory prompt advertises host computer escalation. Interaction refusal
guidance, DOM-script budgets, all authorization/confirmation, browser attach and
execution paths remain unchanged. There is no automatic retry or escalation.

Acceptance uses the actual production memory module: interaction failures permit
reads, read failures cannot poison interactions or durable locator history, fresh
read locators cannot bypass their origin fuse, and legacy history, UNKNOWN health,
reset scope and transport freeze retain their distinct behavior. A guarded CPU
projection is not a native Windows/browser acceptance claim.
