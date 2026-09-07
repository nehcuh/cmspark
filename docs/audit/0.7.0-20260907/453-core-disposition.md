# #453 draft core — review status

**DRAFT PR ONLY: core gate not yet complete.** Grok4.6 R2 has 0 BLOCK/MAJOR and APPROVE_WITH_NITS. Actual DeepSeek V4 Pro R1 reported a time-validation MAJOR despite its overall APPROVE_WITH_NITS wording; R2 final validation is pending. Two full R2 attempts exceeded output limits (one terminated after repeated max_tokens), recorded as incomplete, never approvals. A focused R2 delta + complete affected functions is being reviewed at the same frozen R2 hashes. User explicitly accepts Grok4.6 +DeepSeekV4Pro; CLI identity is not model identity.

R1 major fixes in R2: public checked/read/render DTO removes historical mutation_result, preserving historical mutation replay separately; empty runtime assets use exact fixed empty marker plus an independently cited full same-source business time; business timestamps require full ISO/timezone and complete token; criterion mapping must be single-row explicit pair with no competing known criterion/case; architecture @ components are rejected before derived endpoint join. Core23/23 and production build pass. Broad later development snapshot4975pass/23skip plus settings20/20 is additional machine evidence, not proof of core review completion.

Grok R2 NIT dispositions:

1. Unknown schema-1 extension fields are preserved for forward compatibility; public tools cannot add arbitrary top-level ready/gaps. Local file editing is outside the trusted single-owner store contract. Only historical mutation_result is specifically removed from the public checked view.
2. @ join regression is implemented; its dedicated standalone negative is additional coverage. Existing namespace/human-mapping tests prove endpoint/context checks and refusal paths.
3. Runtime relation uses its endpoint/context field states first; those already require full token timestamp. No date-prefix bypass through the looser relation excerpt check.
4. Persisted created/updated/reply clocks are server generated; manual corruption beyond schema parsing is not an untrusted input API. Public requests cannot choose timestamps or reply status.
5. static_declaration_v1 trusts the locked owner-declared collection scope. It does not infer exhaustive semantics or prove no hidden members elsewhere on a page. Real pilot scope validation remains blocking in #450/#452/#454/#455.
6. Complete-draft current-ready→stale is tested at checkDraft, which service.read/render call; repository/service tests separately cover fresh read time and historical mutation replay.

No core merge/Issue closure until the remaining DeepSeek gate is satisfied. Chat wiring and two Packs have their own completed R2 reviews; that does not approve this core or a real enterprise pilot.
