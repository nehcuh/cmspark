# C10 God-file Split — Phase D (2026-08-11)

Branch: `fix/c10-godfile-split-a` (continues Phase A/B/C on same worktree)

## Goal

Extract **analyze_image IMAGE_FETCH two-phase gate** from `createToolExecutor` into `companion/src/tool/image-fetch-admission.ts` with **zero intentional behavior change**.

## LOC before / after

| File | Before (post Phase C) | After | Δ |
|------|----------------------|-------|---|
| `companion/src/server.ts` | 3490 | 3334 | **−156** |
| `companion/src/tool/image-fetch-admission.ts` | — | 231 | new |
| `companion/tests/image-fetch-admission.test.ts` | — | 289 | new |

*(Exact after-LOC measured on this commit; server Δ includes removed imports + FREEZE wiring.)*

## What moved

### Block 1 — Direct-call reject

- **From** `server.ts` `createToolExecutor`: `if (toolName === "analyze_image_fetch")` reject
- **To** start of `runImageFetchAdmission(ctx): Promise<ToolResult | null>`
- **Behavior preserved**: warn `security.image_fetch_direct_call_rejected`, `logToolFinish`, return blocked result (not `null`)

### Block 2 — Full `analyze_image` two-phase gate

- **From** `server.ts`: full `if (toolName === "analyze_image") { phase1 → data: → scheme/metadata → confirm → phase2 }`
- **To** remainder of `runImageFetchAdmission`
- **Behavior preserved**:
  - phase1 via injected `dispatchToExtension` (same plumbing; stays in `server.ts`)
  - canvas / error path: return phase1 as-is + `logToolFinish`
  - residual `data:` → local `decodeDataUrlImage` (no phase2, no L2, no schemeOk expansion)
  - non-http(s) / invalid URL hard-block
  - cloud metadata IP hard-block (`isCloudMetadataIp`)
  - cookie `trusted_domains` does **not** auto-approve (only `isAutoApprovedDomain` / `auto_approved_domains`)
  - god-mode + `auto_approve_dangerous` do **not** skip IMAGE_FETCH http(s) confirm
  - phase2 synthetic id `${toolCallId}__image_fetch`, tool `analyze_image_fetch`
  - non-analyze / non-fetch tools → `null` (caller continues)

### Wiring in `createToolExecutor`

Order unchanged:

```
multi-agent → cookie → browser_download → L2 → URL → image → dispatch
```

```ts
const imageOutcome = await runImageFetchAdmission({
  toolName,
  finalParams,
  toolCallId,
  startedAt,
  ws,
  logToolFinish,
  securityConfirmations,
  dispatchToExtension, // function declaration; hoisted in server.ts module scope
})
if (imageOutcome !== null) {
  return imageOutcome
}
```

### Re-exports from `server.ts`

```ts
export { runImageFetchAdmission } from "./tool/image-fetch-admission"
```

### FREEZE update

- `createToolExecutor` shell documents image gate living in `tool/image-fetch-admission.ts`
- `url-cookie-admission.ts` FREEZE points image gate to Phase D module (no longer “stays in server”)

## Not moved (deferred)

| Item | Why |
|------|-----|
| `browser_download` path sandbox | Still in server shell |
| `dispatchToExtension` | Stays in `server.ts`; injected by reference (avoids circular deps / pending map ownership) |
| Dual-review of extracted module | Pending (this note flags it) |

## Verification (executed)

```bash
cd companion
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/image-fetch-admission.test.js   # 7 pass
node --test .test-dist/tests/integration/security-gates.test.js # 63 pass
```

All of the above **pass**.

## Constraints honored

- No intentional behavior change
- Critical IMAGE_FETCH invariants preserved (god-mode / auto_approve_dangerous / cookie trust / metadata / data: / synthetic phase2 id / direct-call reject)
- Worktree only (`cmspark-wt-c10-godfile`); no push
