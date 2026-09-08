I'll start by reading only the packet you named, then follow its review instructions without pulling in other context.The packet is longer than the first read; I’ll continue from where it left off so the review is based on the full frozen contents.There's more after the machine logs; I'll keep reading so the verdict isn't based on a truncated packet.Independent closure review of frozen packet #473. Scope: T2 metadata + T3 visibility-only Stop/confirm. #474 icons excluded.

## Outcome / trajectory / components

**Outcome.** Narrow header keeps a persistent `+` (`createBlankThread`, CSS-hidden ≥760). Management is named (`对话管理（历史对话）`) plus wide nav `管理对话`. One `ThreadList` owns time / tags / manual groups / derived AI groups, with explicit AI extract, rules cleanup, graph, and trash. Human `user_tags` persist beside digest; AI group is first digest tag, not a clusterer and not a `topic_folder` write.

**Trajectory.** Save success waits for envelope-id + `thread.id` match and echoed `user_tags` / `topic_folder`. ACK, wrong-thread, missing fields, error, timeout, and abort do not count as saved. Manager is nonmodal, clipped above the composer, no full-window backdrop; pending confirmation closes it and disables entries. Stop remains a real click target.

**Components.** `user-tags.ts` sanitize + router allowlist `user_tags` only; editor submits those two fields. Graph slim keeps `user_tags` separate; color / extract eligibility stay digest-only. Related/search union tags as specified. No permission, default, or background-job change. Fixture/UI tests do not mutate real user data. Machine logs in-packet: ext/companion build+test, thread-management UI, workspace UI all exit 0.

## Closure targets

| Target | Evidence |
|---|---|
| Graph human-only still extractable; digest-only color | `isUntaggedSlim` → `!aiThreadGroup`; `buildTagColorIndex` still `primaryTag(digest.tags)`; unit test pins `UNTAGGED_COLOR` / `未标注` while `threadTags` still sees `负责人` |
| Actual handler `thread.updated` fields | `handleMessage` persist/reload/clear + malformed reject in `thread-digest.test.ts` |
| Outside close exits selection | `mousedown` outside → `setOpen(false)` + `exitSelectMode()`; UI reopens and waits for `选择` |
| Timeout cleanup + matching-envelope wrong thread | `thread-management.test.ts`: wrong `thread.id` does not settle; timeout clears timer/listener; `settled` blocks success |
| Nav management disabled under confirmation | `cm-nav-manage` and header trigger `disabled={pending > 0}`; open event no-ops; panel unmounts; UI asserts header disabled + confirm buttons hittable |

## P0

None.

## P1

None.

## MAJOR

None. T2/T3 and the user ask are met: derived AI view, restored extract/cleanup/graph, human tags vs manual folders, Stop/confirm not intercepted, no new clusterer/defaults/permissions.

## NIT

1. Confirmation Playwright asserts the header trigger, not wide `管理对话`. The `disabled` prop is on the nav button; still a coverage hole at 1440.

2. Timeout “late reply” loops an already-empty listener set. Real guard is `settled` + `removeListener`; the loop does not prove a stray callback is ignored.

3. Cancel is `disabled` for the 15s in-flight window. Unmount/abort still works; user cannot cancel from the form.

4. `handleMessage` pins fields, not WS envelope `id` (expected if the socket layer attaches `id`). Save-path unit tests own that contract; a one-line router/WS pin would make the production echo obvious.

5. AI empty-state copy still keys on `未分组`, so the AI view relies on the help paragraph instead of the empty hint.

## VERDICT: APPROVE_WITH_NITS

Safe to merge for #473. Nits are test/UX polish, not broken save, grouping, or Stop/confirm priority.
