# #456 independent context export — gate status

**Draft PR; do not merge yet.** Grok4.6 full R1 and R2 delta both have 0 BLOCK/MAJOR and approve their scopes. Actual DeepSeekV4Pro full R1 stalled on repeated output max_tokens and was stopped; the incomplete response is archived and not approval. Full R2 independent review is running. User accepts this exact model pair, not a CLI-brand substitute.

Machine at frozen R2: HTTP/context/CLI48/48; Companion full4975pass/23skip/0fail +settings20/20; Extension1277/1277 at R1 (R2 UI prose-only addition) and R2 production build; Companion production build passed. SDK profile11/11. Source manifest: reviews/456-manifest.json. Independent PR CI is still required.

R2 addresses Grok R1 N1–4 and audit ordering: UI/CLI/docs state context origins only restrict context export; session is revalidated after waits and before the operation; only an explicit `session_invalid` flag clears the stdio cache, not an origin deny; issuance revoke errors map403; success audit follows final scope resolution. A real HTTP mock-clock test proves mid-metadata expiry runs no operation, retains no false success, and only the next explicit call creates a replacement session. The separate tab lease is explicitly settled through the production release helper because this harness has no lifecycle worker.

Remaining Grok R1 NIT dispositions:

- N5: metadata resolver updates the shared tab URL cache with the authenticated, sanitized current target. This cache is global browser metadata, not Chat history or scoped failure memory; no cross-scope experience is recovered/exported by it.
- N6: observation_id/evidence_capture on successful context-profile page results are non-capability audit references. There is no material/Observation history read or edit API on this profile. Capture belongs to exact grant/session and cannot access Chat scope.
- N7: selected knowledge has grant-time explicit consent, not page-export HITL. Content under a selected ID can change; each call exports its current version with a final version/deletion check. Docs make this explicit; grant-time version pinning is not promised.
- N8: target URL removes userinfo/query/fragment, but path or knowledge text may contain sensitive business content. Docs disclose that this is not arbitrary body/path secret detection; grant holders must be approved for the selected information.
- N9: bounded session/experience records can remain until a subsequent issue/write prunes them; revoked/expired handles cannot read them. WS/Zod enforce caps even when the UI permits attempting an oversized selection. No new permission is granted by cap overflow.

Grok R2 NIT dispositions:

- N1: stdio automatically handles `session_invalid`; custom HTTP clients must use that explicit flag rather than treating every SCOPE_DENIED as an expired handle (wire behavior documented here; normal users use stdio).
- N2: missing/expired handles are a distinct Error subclass; grant/caller mismatches are ordinary Error and cannot set the invalidation flag. Existing tests cover mismatch denial, origin persistence and expiry recovery.
- N3: session issue maps the exact GRANT_DENIED string thrown by the live-grant check; no permission is relaxed on other errors.
- N4: audit uses the broad SCOPE_DENIED category for both cases; client recovery uses the separate response flag. Finer audit taxonomy can be added without exposing session handles.
- N5: projectOutboundContext has no catch/wrap that erases ContextSessionUnavailable; rejected await preserves the original class for HTTP catch. The hypothetical rewrap is not present.

Default/interact tools are unchanged; empty profile set is corrected to default-only. Page export/HITL and context permission remain independent. No release, installed-app change, real client or enterprise-pilot acceptance is claimed by this local code gate.
