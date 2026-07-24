# host_write Token Mismatch Bug — Kimi+Pi Investigation Brief

> **Date**: 2026-07-16
> **User symptom**: host_write always returns `Invalid or expired security token for host_write`, even after W8 strip-LLM-token fix.
> **Hypothesis (Claude main)**: Token issuance and validation bind to DIFFERENT `code` values for host_write.

## Reproducing trace (from companion log)

```
tool.start host_write
security.auto_approved reason:"god_mode"   ← skipConfirmation=true (god-mode on)
tool.finish error:"Invalid or expired security token for host_write"
```

## Code trace

### Step 1: L2 gate issues token (companion/src/server.ts:438)

```ts
const approvedToken = securityPolicy.issueToken(toolName, code)
```

Where `code` is computed at server.ts:304:
```ts
const code = String(finalParams.code || finalParams.expression || "")
```

For host_write: no `code` field, no `expression` field → **code = ""**.

Token binds to: `(toolName="host_write", code="", threadId="default")`.

### Step 2: host_write case validates (companion/src/server.ts:1138)

```ts
const valid = securityPolicy.validateToken(
  String(params.security_token),
  "host_write",
  String(params.kind || ""),   // ← uses params.kind, not ""
)
```

For host_write create: **validates against code="create"**.

### Mismatch

- Issue: `(host_write, "", default)`
- Validate: `(host_write, "create", default)`
- → `validateToken` returns false (code binding differs)
- → Error: "Invalid or expired security token for host_write"

This bug exists for ALL host_write kinds (create/move/update/delete).

## Candidate fixes

### Fix A: Make issuance use `kind` for host_write

```ts
// server.ts:304
const code = String(
  finalParams.code
  || finalParams.expression
  || (toolName === "host_write" ? finalParams.kind : "")
  || ""
)
```

Pros: Token binds to specific kind — "approve create" ≠ "approve delete". More secure.
Cons: Asymmetric (special-case for host_write).

### Fix B: Make validation use empty string for host_write

```ts
// server.ts host_write case
const valid = securityPolicy.validateToken(
  String(params.security_token),
  "host_write",
  "",  // match issuance
)
```

Pros: Simple. Cons: Token is kind-agnostic — "approve create" auto-approves "delete" within TTL (2 min).

### Fix C: Generic — refactor token issuance/validation to use a "binding payload" string

```ts
function tokenBindingPayload(toolName, params): string {
  if (toolName === "evaluate" || toolName === "osascript_eval") {
    return String(params.code || params.expression || "")
  }
  if (toolName === "host_read") return String(params.application || "")
  if (toolName === "host_write") return String(params.kind || "")
  return ""
}
// Both issuance and validation call this helper
```

Pros: Symmetric, no special-case in two places. Single source of truth.
Cons: Requires refactor (touches gate + 4 cases).

### Fix D: Just remove token validation from host_write case entirely

```ts
// Remove the validateToken block from host_write
// (W8 strip fix already prevents LLM from passing tokens; the gate's issued
// token is for audit trail only, doesn't need re-validation)
```

Pros: Simplest. Trust the strip.
Cons: Defeates defense in depth (if strip is bypassed somehow, no fallback).

## Trade-off matrix

| Fix | Secure | Simple | Symmetric |
|---|---|---|---|
| A (kind in issuance) | ✅ | 🟡 | ❌ |
| B (empty in validation) | ❌ (kind-agnostic) | ✅ | ❌ |
| C (helper) | ✅ | ❌ (refactor) | ✅ |
| D (remove validation) | 🟡 | ✅ | N/A |

## Advisor ask

For each fix:
- Recommend / reject
- Trade-off accepted
- would-block-Phase-1-ship?

Then pick one + one-sentence "if wrong, what happens".

Reference:
- `companion/src/server.ts:304` (code computation in gate)
- `companion/src/server.ts:438` (issueToken call)
- `companion/src/server.ts:1138-1148` (host_write validateToken call)
- `companion/src/security-policy.ts:52-60` (validateToken binding logic)
