**Scope**: evidence gap only — does production Companion echo the request-envelope `id` on `thread.update` success and error responses?

**Finding — gap closed** `[inspected]`. The unchanged wrapper at `lifecycle.ts:1467–1473` stamps `id: msg?.id` onto every `handleMessage` return for the requesting socket via `{ ...response, id: msg?.id }`. This single choke point covers all `thread.update` outcomes:

- Success: router returns `{ type: "thread.updated", thread }` (message-router.ts:3033) → wrapper adds `id`.
- Validation error `thread_id required` (:2985), worker whitelist elevation (:3017–3021, preserves `code`), not-found (:3032), and catch (:3035) → all return `{ type: "error", ... }` → same stamp.
- Handler-throw fallback (:1460–1464) and outer transport catch (:1477, already carries `id`) → both id-stamped.

The client path matches: sidepanel generates the UUID and gates receipt on `message?.id !== id` (thread-management.ts:31), background forwards `id: message.id` into the WS payload (index.ts:994). Request/response pairing therefore works end-to-end; broadcast `thread.updated` pushes lacking the id are correctly filtered by the matcher. The router's id-less returns are by design per the packet premise — stamping belongs to the authenticated WS lifecycle, and the wrapper confirms production parity.

**Tests**: companion/server suites passed per packet (4998 / −23 skipped, +20 aux; 1285 ext; both browser checks); `thread-digest.test.ts:212` exercises the success/error returns though not wrapper stamping — acceptable, since stamping is one shared line and browser checks exercise the real path.

**Nit (only)**:
- `id: msg?.id` yields `undefined` for a caller that omits `id`; `JSON.stringify` silently drops the key, leaving an un-matchable response. The reviewed caller always supplies a UUID, so this is a robustness note, not a defect for #473.

No P0/P1/MAJOR.

**VERDICT: APPROVE_WITH_NITS**
