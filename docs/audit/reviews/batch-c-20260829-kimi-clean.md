# Dual re-review — Batch C path (#247) — Kimi (cleaned)

## Verdict rationale

  The folded spec avoids every REJECT condition in the review rules: pin 9 mandates a dedicated `isUnsafeLoaderEnvKey` table instead of copying `USER_ENV_DENYLIST` (PATH stays); pin 2 keeps zod `url` optional (adapter `pinned_tabs` injection survives); pin 3 replaces `contains` with `URL of t is pageUrl` and locks the keep-query/drop-hash canonical form; pins 4–5 put the canonical URL in both the L2 preview and the HMAC payload and route all issue/validate through `issueTokenFor`/`validateTokenFor`; pin 11 forbids fail-open on parse-null; pin 12 clones the Darwin dual opt-in and explicitly dethrones `NODE_ENV`; NEVER bars D/E, `SUMMONER_ALLOW`, and overlay mixing. Calibration is right: C4/C5 stay at T3 post-auth integrity, no php `-r`/`node -p`/pack-freeze demands.

  Live-code spot-checks confirm the diagnoses are real: `companion-dispatch.ts:1056-1068` (insertion-order cache fallback), `:1095` (legacy `validateToken` on jsExpr only), `message-router.ts:3917` (same legacy pair), `spawn.ts:19` (`length > 0` treats `[]` as missing), `powershell.ts:63-67` (`NODE_ENV` as gate vs. Darwin's dual opt-in at `host-bin.ts:68-76`), catalog:1093-1108 teaching `zhihu.com` fragment + required url. The pins fix exactly these.

  ## Confirmed pins (folded correctly)

  - C1 pins 1–5: tabId recovery with no cache-tail fallback; catalog `required=["expression"]` + zod url optional; single-resolution exact-URL contract (no `new URL().href` re-serialization); preview carries URL; `bindingPayloadFor("osascript_eval")` += URL, execution uses the bound URL. `l2-admission.ts:1636` already issues via `issueTokenFor`, so injecting the resolved URL into `finalParams` before issue closes the loop.
  - C2 pins 6–9: sorted key names / `env: (none)` / no values; deny-not-strip at add/update plus fail-closed `buildMcpStdioEnv`; scoped loader list (case-insensitive, `DYLD_`/`BASH_FUNC_` prefixes) with `PATH` and operator keys preserved.
  - C3 pins 10–11: parsed-argv scan for attached/clustered flags, parse-null still scans after `ENV=` skip with raw-regex backup; DoD negative is `python3 '-c' 'code'`.
  - C4 pin 12: `WIN_SCRIPTS` + `ALLOW!=="1"` → throw, `ALLOW=1` honored under `NODE_ENV=production`, test updated, dev flow untouched.
  - C5 pins 13–15: canon = sort+unique+JSON, `[]` ≠ missing, apply-bound params, reorder passes, HARD_DENY intact; pack residual honestly named-not-fixed (no "execution uses only the bound set" claim when `pack_id` is set).

  ## Missing / still BLOCK

  None. Every four-lane BLOCK traceable to a pin; no pin contradicts live code.

  ## Nits

  1. `message-router.ts:3887-3926` also hard-fails on `!pageUrl` and forwards only `{url, expression}` — it drops `tabId`. The file-map row for `message-router.ts` should say "改 `validateTokenFor` **并**转发 tabId / 废 fragment 硬失败", or pin 1's contract dies on the WS relay path even after dispatch is fixed.
  2. Pin 10's short-cluster scan applies to any bare entry, not just interpreters: `grep -ic pattern`, `wc -c file` will start failing. Fail-closed is acceptable at T3, but either scope the cluster rule to known interpreters or write the false-positive into the error text.
  3. Pin 8's `buildMcpStdioEnv` fail-closed will break legacy persisted configs carrying loader keys at spawn time (incl. the `mcp.toggle_enabled` path) — the thrown error must name the offending key, else it reads as a regression.
  4. Pin 3's "解析一次" should be explicit that l2-admission writes the canonical URL back into `params.url` before `issueTokenFor`, so preview, HMAC, and dispatch read one field (implied, not stated).

  ## Recalibrated: implement now?

  YES — after folding the four nits (all one-liners in spec/file map). Path is TDD-ready.

  VERDICT: APPROVE_WITH_NITS
