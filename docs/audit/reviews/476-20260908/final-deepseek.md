DESIGN_VERDICT: APPROVE_WITH_NITS

NITS:

1. **Slice 2 compatibility matrix**: The audit document correctly identifies `assertSummonerAllowed(surface !== summoner)` as permissive in isolation but guarded elsewhere. The plan should explicitly require a negative integration test that proves the full guard chain (validation → HMAC → surfaceFromOrigin) rejects a forged desktop surface, not just a unit test on the helper. The audit's warning is wise; formalize it as an exit item.

2. **Capability handoff edge**: Plan step 2 says “clear inheritance before any further child spawn.” Consider also requiring that the parent drops its own readable handle after writing the bootstrap to the pipe—single-reader-by-construction prevents a compromised parent later replaying the secret. Minor, aligns with the plan's stated goal.

3. **Native dialog identity**: Slice 3 requires native OS chrome for confirmations. Add a test that a synthesized `NSAlert`/TaskDialog suppression (e.g., programmatic button activation) without the native controller's decision callback yields no grant; the renderer exclusion is covered, but native-chrome spoofing is not stated as an exit case.

4. **Slice 5 agent loops**: “UI cannot assert a user gesture via untrusted message content” is present but slightly buried. Make this an explicit exit test in slice 5: an agent-initiated ACP/PTY loop embedded in chat content must fail confirmation without a genuine user action from the native dialog.

PROTOTYPE_VERDICT: APPROVE

The primitive is clean and correctly scoped: no transport integration, no renderer exposure, immutable method table, TTLs, single-use challenges, HMAC input binding all fields, connection- and protocol-bound authentication, object-identity principals, and delayed disconnect safety. Tests cover the meaningful negative and lifecycle cases—forged principal, foreign socket, replay, expiry, reconnect replacing authority, revocation, bounded issuance, and zeroing. No release implication. Suitable to remain open pending launch/confirm/native integration as planned.