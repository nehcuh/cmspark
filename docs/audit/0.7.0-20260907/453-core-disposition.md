# #453 draft core — review status

**Core gate complete; real pilot/release not approved.** Grok4.6 full R2: APPROVE_WITH_NITS, 0 BLOCK/MAJOR. Actual DeepSeek V4 Pro R1 + focused R2: all R1 majors resolved; R2 reports 0 BLOCK/MAJOR and “push-ready”. User explicitly accepted this independent model pair. Git commit 9145e244 source bytes match every core/wiring frozen R2 manifest hash.

DeepSeek's first two full R2 attempts exceeded output limits (one stopped after repeated max_tokens) and remain archived as incomplete, never approvals. An immediately cancelled focused invocation named the wrong number of parts and is also not counted. The completed focused invocation explicitly read all three parts: the R1→R2 delta plus all affected field/checker/service/render functions. It reviewed the exact same R2 source, not a reduced implementation. CLI identity is not model identity; modelUsage confirms deepseek-v4-pro.

R1 major fixes in R2: public checked/read/render DTO removes historical mutation_result, preserving historical mutation replay separately; empty runtime assets use exact fixed empty marker plus an independently cited full same-source business time; business timestamps require full ISO/timezone and complete token; criterion mapping must be single-row explicit pair with no competing known criterion/case; architecture @ components are rejected before derived endpoint join. Core23/23 and production build pass. Broad later development snapshot4975pass/23skip plus settings20/20 is additional machine evidence, not proof of core review completion.

Grok R2 NIT dispositions:

1. Unknown schema-1 extension fields are preserved for forward compatibility; public tools cannot add arbitrary top-level ready/gaps. Local file editing is outside the trusted single-owner store contract. Only historical mutation_result is specifically removed from the public checked view.
2. @ join regression is implemented; its dedicated standalone negative is additional coverage. Existing namespace/human-mapping tests prove endpoint/context checks and refusal paths.
3. Runtime relation uses its endpoint/context field states first; those already require full token timestamp. No date-prefix bypass through the looser relation excerpt check.
4. Persisted created/updated/reply clocks are server generated; manual corruption beyond schema parsing is not an untrusted input API. Public requests cannot choose timestamps or reply status.
5. static_declaration_v1 trusts the locked owner-declared collection scope. It does not infer exhaustive semantics or prove no hidden members elsewhere on a page. Real pilot scope validation remains blocking in #450/#452/#454/#455.
6. Complete-draft current-ready→stale is tested at checkDraft, which service.read/render call; repository/service tests separately cover fresh read time and historical mutation replay.

DeepSeek R2 NIT dispositions: overlapping criterion texts conservatively become unverified; no inferred pairing or false-ready relaxation is added, and real pilot adaptation remains required. Supported business time syntax is explicitly documented in the pilot guide (uppercase T/Z or ±HH:MM, optional 1–3 fractional digits). The unused destructured omit-variable is an intentional TypeScript pattern and build passes.

Chat wiring and both Packs have their own completed R2 reviews. Merge/Issue closure still requires this PR's independent CI; true enterprise scenarios and release remain gated in #450/#452/#454/#455/#457.
