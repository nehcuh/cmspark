# Supply-Chain Posture — CMspark (`chrome-extension` + `companion`)

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
| **chrome-extension — production deps** (`dependencies`, ship in the MV3 bundle) | **0** | **Gating** — `npm audit --omit=dev` must pass |
| **chrome-extension — dev-toolchain** (`devDependencies`, bundler + plugins, never shipped) | 71 (1 low / 3 moderate / 67 high) | **Informational** — `continue-on-error: true` |
| **companion — production deps** (`dependencies`, ship in the packaged binary) | **2 moderate** (`node-notifier` → `uuid`) | **Gating** — `npm audit --omit=dev --audit-level=high` |

The extension that users install contains **zero** known-vulnerable packages.
The companion ships two triaged, blocked-on-upstream moderate advisories and
zero high/critical. All remaining extension advisories live in the build tool
(plasmo + Parcel) and its plugins, which compile the bundle but are not present
in the shipped artifact.

## chrome-extension (`chrome-extension/`)

### Fixed in P1-2

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

## CI — chrome-extension

`.github/workflows/ci.yml` runs two audit steps for `chrome-extension`:

1. **PRODUCTION (gating)** — `npm audit --omit=dev`. Fails the build on any
   shipped-dep advisory. Currently green (0). Escape hatch if a shipped dep
   gains an advisory we can't patch immediately: add a targeted `overrides`
   entry, record the accepted risk here, and re-pin.
2. **Full tree (informational)** — `npm audit` with `continue-on-error: true`.
   Surfaces the known dev-toolchain set plus any **new** advisory for triage
   without gating on the unfixable plasmo/Parcel noise.

## Companion (`companion/`)

Companion is a Node.js+TypeScript local server (`cmspark-agent`) packaged as a
CLI/binary. Its `dependencies` ship in the distributed artifact; `devDependencies`
(`tsx`, `typescript`, `@types/*`) are build-time only.

### Current state

`npm audit` reports **2 moderate** vulnerabilities, both in the production tree,
both the same chain: `node-notifier >=7.0.0` → `uuid <11.1.1`
(GHSA-w5hq-g745-h8pq, "Missing buffer bounds check in v3/v5/v6 when buf is
provided"). **0 high/critical.** `npm audit --omit=dev --audit-level=high`
exits 0.

### Fixed in P1-2

1. **Removed unused `dompurify` + `@types/dompurify`** (`dependencies`).
   Companion is a Node server that never renders untrusted HTML/SVG — DOMPurify
   sanitization is the **extension's** job (ADR-009 Mermaid SVG). These were
   dormant leftovers (`grep` across `companion/src`, `tests`, `scripts`: zero
   references). Removing them shrinks the shipped dep surface.
2. **C4 zip-slip closed and documented.** The original C4 critical involved
   officeparser's historical use of `decompress` (GHSA-mp2f-45pm-3cg9). The
   current `officeparser@7.2.3` tree **no longer depends on `decompress` at all**
   (`npm ls decompress` is empty), so the advisory no longer appears in audit.
   The pre-flight central-directory walk in `companion/src/file-parser.ts:172-239`
   (canonical EOCD validation + symlink-mode rejection, kimi-reviewed
   2026-07-10) stays as defense-in-depth so a future officeparser/decompress
   regression cannot reopen the user-upload RCE path.

### Accepted risk — `node-notifier` → `uuid` (moderate, blocked on upstream)

This cannot be fixed without a breaking change, so it is accepted:

- `node-notifier@10.0.1` is the **latest** published version and pins
  `uuid@^8.3.2`. There is no newer node-notifier release to bump to.
- `npm audit fix --force` proposes **node-notifier@6.0.0** — a major downgrade
  (breaking). Not acceptable.
- An `overrides` pin of `uuid` to `^11.1.1` (the only clearing range) is unsafe:
  uuid 8→11 dropped the CommonJS deep-require API (`require('uuid/v4')`) that
  node-notifier@10 uses; forcing uuid-11 breaks notification generation at
  runtime. (uuid 9.x keeps the API but is still `<11.1.1`, so it does not clear.)
- **The vulnerable code path is not exercised.** The advisory is "v3/v5/v6
  **when buf is provided**". node-notifier's only uuid usage is
  `notifiers/toaster.js`: `const { v4: uuid } = require('uuid')` called as
  `uuid()` with no caller-supplied buffer — a v4 call with no buf, so the
  v3/v5/v6 buffer-bounds branch is never reached.
- **On macOS (the primary platform) node-notifier is not even called**:
  `menu-bar-agent.ts` `safeNotify()` uses native `osascript display notification`
  on darwin; node-notifier is only the Linux/Windows fallback.

Real-world risk: low. Re-evaluate when node-notifier releases a version pinning
uuid ≥11, or if companion adds a notification path that supplies a buffer to a
v3/v5/v6 uuid call (none today).

### CI — companion

`.github/workflows/ci.yml` runs one gating audit step for `companion`:

- **PRODUCTION (gating, high+)** — `npm audit --omit=dev --audit-level=high`.
  Fails the build on any high/critical advisory in shipped deps. The 2 known
  moderate (node-notifier→uuid) are below the `high` bar, so they do not gate;
  any NEW high/critical on a shipped dep blocks CI. `--omit=dev` scopes to
  shipped deps; companion devDeps are build-time only and not in `dist/`.

Companion gates at `high+` rather than all-severities (as the extension does)
because it cannot reach 0 moderate without a breaking node-notifier downgrade
or a runtime-breaking uuid override. Escape hatch if a future shipped dep gains
a moderate we can't patch: document it here as accepted risk.

## Re-evaluation trigger — chrome-extension

When **plasmo** releases a version that bumps its Parcel dependency (watch
`plasmo` releases / `@parcel/core` resolution in `npm ls @parcel/core`),
re-run `npm audit` after upgrading. The entire blocked-on-upstream set above is
expected to clear in one plasmo bump; until then it is accepted, bounded to the
build toolchain, and separated from the shipped surface by the production audit
gate.

## Re-evaluation trigger — companion

Re-run `npm audit --omit=dev` when: `node-notifier` publishes a release that
pins `uuid` ≥11 (would clear the 2 moderate); or companion adds a new direct
production dependency. The `--audit-level=high` CI gate will surface any new
high/critical on a shipped dep automatically.
