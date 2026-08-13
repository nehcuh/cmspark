I've inspected the patch file against the live repo (working tree is clean at `03aca58`, patch is not stale — it corresponds to `4e82434..03aca58`), read the ADR-020 checklist, and traced every security-critical path in the actual source. I also executed the apply path directly to test a non-trivial case.

## Verification results (security gates)

| Check | Result |
|---|---|
| `acp_apply_diff` tool always HITL | ✅ `companion-dispatch.ts:361-378` requires `security_token` + `validateTokenFor`; token signature binds `session_id`+`paths` (`security-policy.ts:101-102`) |
| `acp.apply_diff` WS always HITL | ✅ `handlers.ts:213-223` → `confirmOrDeny`; returns `false` if no confirm channel (`handlers.ts:35-41`), fail-closed |
| Never waived by cruise/god-mode | ✅ `l2-admission.ts:790-826` — `forceConfirm = acpForceConfirm || ...`; `acp_apply_diff` in both `L2_GATE_TOOLS` (:65) and `acpForceConfirm` (:791) |
| Path escape rejected | ✅ `diff-apply.ts:60-61` (abs/null-byte) + `:143-160` (`../`, `..`, realpath containment on parent). Final-component symlink escape is neutralized by `atomicWriteText` rename semantics (`io.ts:32-45`) |
| No free shell | ✅ `spawn(server.command, args, {…})` with no `shell:true` (`manager.ts` ~320); `command` is realpath'd absolute path (`discover.ts`), args are fixed presets |
| Follow-up requires confirm | ✅ `followup` → `propose` (offered) → `confirmOrDeny` → `start` (`handlers.ts:119-180`) |
| Catalog lockstep | ✅ `acp_apply_diff` present in `companion-tools.ts:41`, `tool-definitions-catalog.json:1284`, `security-policy.ts:101`, `orchestrator/constants.ts:31` (WORKER_HARD_DENY), `l2-admission.ts:65`, `companion-dispatch.ts:361` |
| originWs | ✅ WS path binds `{ originWs: ws }` (`lifecycle.ts:1203-1211`); apply reuses the existing origin-bound channel, no new confirm dialect |

ADR-020 declaration is present (Surface / Compose / Autonomy / Trust stated); only `Channel:`/`L2-classes:` fields are omitted — minor, not blocking given the declaration exists.

## Blocking issue

**1. `propose_diff` apply truncates modified files (data loss).** `reconstructFromHunks` (`companion/src/acp/diff-apply.ts:83-117`) builds the new file body by concatenating only `+` and context lines from hunks — it has no notion of the file outside the hunk ranges. `applyParsedDiffs` then writes that fragment as the **entire** file for any non-delete file with non-null `newContent` (`diff-apply.ts:170-176`). The `isNew` flag is computed (`:63`) but never used to gate the write.

I verified this empirically against the actual module:

```
applied: ["big.txt"]
original lines: 101
result lines: 6
result content: "line47\nline48\nLINE49-CHANGED\nline50\nline51\n"
```

A realistic 101-line file with a 5-line hunk becomes a 6-line file after "应用 diff". This is the **normal case** for modified files (agents emit minimal hunks, not full rewrites), so the core P3 write feature will silently destroy file contents. The soft prompt instruction "Prefer complete file rewrites" (`manager.ts`) is not enforcement, and the handback summary shows `- M foo.ts` with no truncation warning (the `（需人工在 IDE 应用）` marker only appears when `newContent == null`).

This is not covered by the new tests — `acp-diff-apply.test.ts` only exercises *new-file* apply and path-escape, never a modified-file (`M`) apply.

**Required fix:** gate the write to files that are genuinely reconstructable (new file, or detected full-file rewrite e.g. hunk spanning `@@ -1,N +1,M` / `@@ -0,0`), and skip everything else with an explicit reason (e.g. `partial_hunk_unsupported`) instead of writing a truncated body — plus a regression test for a partial-hunk `M` file.

## Non-blocking nits (for completeness)

- `followup` from a `propose_diff` session downgrades to `review_readonly` because the UI doesn't pass `mode` and `handlers.ts` defaults it (`handlers.ts:126-128` → `manager.followup` `mode: opts.mode || parent.mode`), losing the parent's propose-diff capability.
- `hasPendingDiff` is set from raw `pending_diffs.length` (`agentStore.tsx:951-954`), so the "应用 diff" button appears even when every file is `applyable:false`/delete — apply then no-ops.
- `reconstructFromHunks` also mis-handles multi-hunk files (concatenates hunks, duplicating/overlapping context), reinforcing #1.
- `resolveLaunchArgs` claude-splice runs even when `configuredArgs` already positioned the prompt, potentially duplicating the prompt argv (cosmetic; no shell risk).

VERDICT: REJECT
