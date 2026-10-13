# Enterprise browser capacity recovery (#624)

The service retains at most 128 sessions / 1024 operations. It never silently evicts active or terminal claims under usable authority. At capacity, new work stops with `CAPACITY`; existing idempotent requests remain queryable. Expiry alone does not make history safe to discard (clock changes could make expired authority usable again).

Local administrator procedure:

1. Stop the Companion process and close the dedicated enterprise browser/profile, including all previously managed tabs. A browser action already dispatched may have completed: inspect ambiguous outcomes separately; do not retry them as new operations.
2. Use `cmspark-agent outbound-grant list` and revoke every grant referenced by the state being rotated with `outbound-grant revoke --grant-id ID`. Retain the audit trail. An expired-but-unrevoked grant is insufficient.
3. Run `cmspark-agent outbound-grant rotate-enterprise-state --quiesced`. This acknowledges the actual process/browser shutdown; the lock only proves no concurrent enterprise state writer. The command validates explicit revocations while holding the authority writer lock, creates a unique 0600 archive in the 0700 `enterprise-browser-archives` directory, then atomically resets the active store. Archive failure or reset failure leaves the original claims intact.
4. Restart Companion and a fresh dedicated browser/profile; issue a new enterprise grant and create new sessions. The new grant has a new idempotency namespace. Old tokens, handles and signed approvals cannot authorize fresh work. Never restore the archive over a running service or un-revoke an old grant.

The extension independently tracks 128 managed tab histories. Closing old tabs/profile in step 1 is required to recover that budget; resetting Companion JSON alone does not recover it. Ordinary business evidence stays process-memory-only; the archive contains claim metadata, not pictures, page text or typed values. Retain/delete private archives under the administrator's normal retention policy.

`STATE_BUSY` / `GRANT_STORE_BUSY` means a writer lock exists. Do not steal it based on age or PID. For a crashed writer, first verify all Companion/CLI writers and the dedicated browser are stopped, preserve the state and audit, then remove only the confirmed stale lock locally and repeat this procedure. Missing/corrupt authority fails closed; restore a verified authority backup, never infer revocation from missing records.
