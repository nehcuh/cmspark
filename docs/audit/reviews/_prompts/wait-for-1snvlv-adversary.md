# Independent adversary — wait_for tabId-only default (thread 1snvlv)

You did **not** write this code. Do not rubber-stamp. Read the real diff and source. Use tools.

## Blast
T2 L1. No new L2. `wait_for` / `create_tab` load-wait behavior.

```text
Surface:      L1 (wait_for default network_idle; create_tab waits for load)
L2-classes:   none
Compose:      none
Autonomy:     single
Trust:        no new confirm dialect; classifyError recoverability only
Channel:      community
```

## Trace (what shipped in prod)
Thread `1snvlv` 2026-08-21T16:09Z:
1. `create_tab(https://zhuanlan.zhihu.com/write)` returned `{id, url:"", title:""}` (no load wait)
2. glm-5.3 called `wait_for({tabId})` only (24 completion tokens)
3. Extension threw `selector or network_idle is required` (4ms)
4. `classifyError` → **non_recoverable** → Side Panel `⚠️`
5. User 「继续」; same wait_for again; same stop

Catalog `required: [tabId]` only. Runtime required selector OR network_idle.

## Claimed fix
- Extension `resolveWaitForMode`: tabId-only / timeout-only → `network_idle` (timeout caps load wait; settle default 2000). `network_idle:false` without selector still invalid (`WAIT_CONDITION_REQUIRED`).
- Companion `normalizeWaitForParams` injects `network_idle:true` before execute (old unpacked extension still works).
- `create_tab` waits for load like `navigate` unless `wait_for_load === false`.
- `classifyError` matches `selector or network_idle` / `wait_condition_required` as recoverable.
- Zod `wait_for` **must not** require selector|network_idle (that would re-kill 1snvlv at schema).
- Catalog description + `settle_ms`. Adapter rule 6 documents tabId-only = network_idle.
- Dead duplicate return after network_idle success removed.
- `waitForTabLoad` takes timeout; `done` flag so listener is not leaked on double-resolve.

## Machine [executed in this worktree]
- companion targeted 128 pass; `tsc -p tsconfig.test.json` 0
- chrome wait-for-mode 5/5; `tsc --noEmit` 0
- Diff: `docs/audit/reviews/wait-for-1snvlv-diff-20260822.patch`
- Worktree: `/tmp/cmspark-wait-for` branch `fix/wait-for-default` vs `origin/main` (`bebb8c4`)

## DoD (external observables)
1. `wait_for({tabId})` does not throw the 1snvlv string; defaults to load+settle.
2. `wait_for({tabId, selector})` still polls selector (selector wins).
3. Zod accepts tabId-only.
4. Missing-arg leftover is recoverable (not chat.error ⚠️ as non_recoverable).
5. `create_tab` waits for complete before returning url/title (unless wait_for_load false).
6. Default wait is bounded (timeout, not infinite).
7. No new L2 / host_computer / confirm dialect.

## Job (your lane is specified in the spawn prompt)
Score outcome / trajectory / component. Cite file:line. Evidence tag [executed]/[inspected]/[assumed].
Final line MUST be exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
