# Supply-Chain Posture — `chrome-extension`

> Companion to the 2026-07-09 full audit (`audit-report-cmspark-2026-07-09.md`,
> finding "supply-chain") and remediation plan (`docs/remediation-plan-2026-07-09.md`,
> item **P1-2**). Last updated 2026-07-11.

This document records what was fixed, what is deliberately **accepted as
blocked-on-upstream risk**, and why, so the decision is reviewable and the
re-evaluation trigger is explicit. It exists so a future reader (or `npm audit`
alarm) can tell a *known, triaged* advisory from a *new, actionable* one.

## TL;DR

| Surface | Vulnerabilities | CI posture |
|---|---|---|
| **Production deps** (`dependencies` — ship in the MV3 bundle) | **0** | **Gating** — `npm audit --omit=dev` must pass |
| **Dev-toolchain** (`devDependencies` — bundler + plugins, never shipped) | 71 (1 low / 3 moderate / 67 high) | **Informational** — `continue-on-error: true` |

The extension that users install contains **zero** known-vulnerable packages.
All remaining advisories live in the build tool (plasmo + Parcel) and its
plugins, which compile the bundle but are not present in the shipped artifact.

## Fixed in P1-2

1. **`dompurify` 3.4.8 → 3.4.11** (`dependencies`, direct).
   The only vulnerable package that actually ships and runs in the extension.
   DOMPurify sanitizes untrusted Mermaid SVG output on the Side Panel page
   (ADR-009) — a privileged MV3 context (`<all_urls>`, `debugger`, `cookies`).
   A sanitizer bypass here is high-impact despite npm's "moderate" label, so the
   floor is pinned to `^3.4.11` and guarded by the gating production audit.
2. **`js-yaml` override → `^4.1.2`** (transitive, resolves to 4.3.0).
   Pulled by `plasmo → @parcel/config-default → @parcel/optimizer-htmlnano →
   htmlnano → cosmiconfig`. Same-major patch; verified the build still produces
   the bundle (12.3s, exit 0). Demonstrates the override mechanism for future
   leaf-utility fixes.

After both: `npm audit` went **73 → 71**; `npm audit --omit=dev` went to **0**.

## Accepted risk — blocked on upstream (build-time only, NOT shipped)

These cannot be fixed without plasmo bumping its Parcel pin, which npm's only
suggestion confirms (`npm audit fix --force` proposes downgrading plasmo to
`0.50.1`, a breaking non-solution). They are evaluated as **low real-world
risk** because they are dev-toolchain: the bundler and its plugins run on
developer machines and the CI runner, never in the shipped extension.

- **`plasmo@0.90.5`** (high) — the build framework itself. Root of the tree.
- **`@parcel/*`** (high, ~30 packages) — the bundler core plasmo pins at `2.9.3`
  (`@parcel/core`, `@parcel/plugin`, `@parcel/types`, `@parcel/fs`,
  `@parcel/cache`, `@parcel/package-manager`, `@parcel/workers`, all
  transformers/optimizers/packagers/runtimes/resolvers/reporters).
- **`@plasmohq/parcel-*`** (high) — plasmo's Parcel plugins
  (`@plasmohq/parcel-core`, `parcel-config`, `parcel-bundler`,
  `parcel-transformer-manifest`, `parcel-transformer-svelte`,
  `parcel-transformer-vue`, etc.).
- **`content-security-policy-parser`** (high), **`lmdb`** (high),
  **`msgpackr`** (high) — all transitive through plasmo/Parcel.
- **`esbuild`** (moderate) — dev-server cross-origin advisory; dev-server only.
- **`tsup`** (moderate), **`@babel/core`** (low) — build-time.

### Why `svelte` is documented, not overridden

The task brief said "svelte overrides **where safe**". There is **no safe
override** here, verified empirically:

- `svelte@4.2.2` is pulled transitively by
  `plasmo → @plasmohq/parcel-config → @plasmohq/parcel-transformer-svelte@0.6.0`.
- The advisory range (`<= 5.55.6`) spans **all** 4.x, so pinning the last 4.x
  (`4.2.20`) does **not** clear it (confirmed: still flagged after install).
- The only clearing version is svelte **5.x**, a major bump that breaks the
  unused `parcel-transformer-svelte@0.6.0` (written for the svelte-4 compile API).

Mitigating context: this is a **React** extension with no `.svelte` sources, so
the transformer is loaded by the Parcel config but never compiles anything, and
the advisories are predominantly **SSR**-specific (irrelevant to a build-time
transformer that does no SSR). Net runtime risk: none. Override would be
security theater that risks the build. → documented as blocked-on-upstream.

## CI

`.github/workflows/ci.yml` runs two audit steps for `chrome-extension`:

1. **PRODUCTION (gating)** — `npm audit --omit=dev`. Fails the build on any
   shipped-dep advisory. Currently green (0). Escape hatch if a shipped dep
   gains an advisory we can't patch immediately: add a targeted `overrides`
   entry, record the accepted risk here, and re-pin.
2. **Full tree (informational)** — `npm audit` with `continue-on-error: true`.
   Surfaces the known dev-toolchain set plus any **new** advisory for triage
   without gating on the unfixable plasmo/Parcel noise.

## Re-evaluation trigger

When **plasmo** releases a version that bumps its Parcel dependency (watch
`plasmo` releases / `@parcel/core` resolution in `npm ls @parcel/core`),
re-run `npm audit` after upgrading. The entire blocked-on-upstream set above is
expected to clear in one plasmo bump; until then it is accepted, bounded to the
build toolchain, and separated from the shipped surface by the production audit
gate.
