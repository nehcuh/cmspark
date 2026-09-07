I'll read the review packet exactly as specified and stay within its constraints: no other files, no edits, no commands, no subagents.## Scope

Independent W1 historical-origin review from this packet only. Compared the included 63aa4c63 producer (`originKeyFromUrl` + `canonicalizeSiteOrigin` + `originForSiteOp`) to the final `siteExperienceIdentity` / `readSiteExperienceEntries` / `isOwnedSiteExperience` path and its tests. Did not assume a raw-URL filename producer.

## Historical producer, from the included source

Origin is formed **before** any skill name:

1. `originKeyFromUrl` parses with `new URL`, then returns `` `${u.protocol}//${u.host}` ``. WHATWG `host` lowercases the hostname and **keeps a non-default port**.
2. `originForSiteOp` always runs that result through `canonicalizeSiteOrigin`, which is only:

```ts
origin.replace(/^(https?:\/\/)www\./i, "$1")
```

So this path cannot emit a raw `www` origin. Examples:

| Input URL | After `originKeyFromUrl` | After `canonicalizeSiteOrigin` |
|---|---|---|
| `https://www.Example.COM/path` | `https://www.example.com` | `https://example.com` |
| `https://example.com:8443` | `https://example.com:8443` | `https://example.com:8443` |
| `https://www.example.com:8443` | `https://www.example.com:8443` | `https://example.com:8443` |
| `https://example.com:443` | `https://example.com` | `https://example.com` |

A filename derived from that canonical origin’s **host** is therefore `example-com` or `example-com:8443`, not `www-example-com`. The previous `www-example-com` miss is not a W1 regression of this producer.

## Final helper vs that producer

```ts
host: url.hostname.toLowerCase().replace(/^www\./, "")
legacyId: url.host.toLowerCase().replace(/^www\./, "").replace(/\./g, "-")
```

- `host` / v1 hash: apex hostname, www-stripped, **port-blind**.
- `legacyId`: same www/case fold on `url.host`, dots → hyphens, **port retained**.

That reconstructs the historical key from either a raw URL or an already-canonical origin:

- `https://www.Example.COM` → `example-com` (tested)
- `https://example.com:8443` → `example-com:8443` (tested)
- hostname-only `example.com` is parsed as `https://example.com` → `example-com`

Read-through probes `[v1 id, legacyId]`, accepts pre-`auto` tags **only** on the legacy id, requires `type === "site_knowledge"` + `site-op-memory` + host match, and refuses `*` / `,` sites. `isOwnedSiteExperience` does not set `legacyRead`, so v1 writes still need `auto`. Tests lock those guards and v1-over-legacy precedence.

## Remaining W1 regressions

**None.** When the caller supplies the origin/port, the helper probes the key this producer actually wrote. New v1 writes stay metadata-bound.

Explicitly **not** a W1 miss (deferred as stated): a hostname-only caller cannot guess `example-com:8443`. That follows from the producer keeping `u.host`; it is not introduced by this patch.

## Nits (non-blocking)

1. Tests cover www/case and port separately, not the composed historical case `https://www.Example.COM:8443` → `example-com:8443`. The two transforms compose correctly in code; one extra assertion would stop the next review from re-deriving it.
2. The 63aa4c63 excerpt still does not show `createExperienceSkill`’s string transform. Given `u.host` + www-strip **before** naming, and port kept as `:8443` rather than mashed, `legacyId` is the only mapping consistent with this source. Not a reason to re-invent `www-example-com`.

VERDICT: APPROVE_WITH_NITS
