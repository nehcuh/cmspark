I'll read the packet and follow its review instructions exactly.**Evidence question:** Does production Companion echo the request envelope `id` on `thread.update` success and errors?

**Finding:** Yes. The router correctly does **not** stamp `id`. The authenticated WS wrapper does.

**Success path.** `handleMessage` returns `{ type: "thread.updated", thread }` (`message-router.ts` ~3033). Lifecycle then sends `{ ...response, id: msg?.id }` (`lifecycle.ts` ~1467–1472). The request `id` from the inbound envelope is copied onto the wire payload.

**Error paths, same stamp.**
- Router validation / not-found / worker elevation / `update()` throw: `{ type: "error", error }` (and optional `code`) — then the same spread + `id: msg?.id`.
- `handleMessage` throw: constructed `{ type: "error", ... }` then the same send (~1454–1472).
- Outer `ws.message_error`: `{ type: "error", id: msg?.id, error }` (~1476–1477).

**Client contract matches.** `saveThreadMetadata` mints `thread-metadata-${uuid}`, background forwards `id` on `thread.update`, and the listener keys on `message.id`. Companion echo is what makes that match work. Direct `handleMessage` tests omitting `result.id` are not a gap; they never hit the wrapper.

**Not in scope.** `#474` icons. `sendToExtension` fan-out for `thread.updated` is a push path, not the request ack. No demand that the router return `result.id`.

No P0 / P1 / MAJOR.

**VERDICT: APPROVE**
