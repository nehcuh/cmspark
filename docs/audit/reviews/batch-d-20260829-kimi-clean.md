# Dual re-review — Batch D path (#249) — Kimi (cleaned)

## Verdict rationale

  The path survives every REJECT rule, and the spec's factual premises are accurate against `10a6a322`-baseline code:

  - **Rule 1 (a–e):** Pin 4 explicitly forbids copying `chat.abort` onto close (names `rejectForWorker`, tab-lease, `drainNextRun` as banned). Pin 6 explicitly forbids header-only and mandates Cookie-first-paint. Pin 10 bans `broadcastToClients` fanout and its allowlist contains no `security.confirmation.*`; pin 11 keeps confirms origin-bound. Pin 6 mandates **no** `Secure` on the loopback cookie — the opposite of the reject trigger. The NEVER list bans touching `SUMMONER_ALLOW` / overlay Allow/Deny. Clean on all five.
  - **Rule 2:** Pin 5 keeps D3's token-out-of-argv (`isSummonerLoopbackUrl` must reject token query; `planSummonerShellOpen` must not put 64-hex in argv). The skeptic's downgrade is acknowledged in the synthesis but correctly does not delete D3.
  - **Rule 3:** Pin 9 explicitly forbids touching `untrustedSuffix` `"x"`; the "将红" note keeps `text-sanitize.test.ts` green.

  Independent spot-checks (not from the strawman):

  - `skill-engine.ts:483` and `:655` — two real `new ThreadManager()` call sites. Confirmed.
  - `thread-manager.ts:760-764` — `get()` seeds `run_progress` then calls `saveIndex()` on a read path. Confirmed.
  - `message-router.ts:802` — `file.upload` claims the slot with `abortControllers.set` but never stamps `llmLoopOwnerPanel`, unlike `:571-572` and `:1513-1514`. Confirmed gap; D2-UPLOAD-OWNER is real and narrow.
  - `lifecycle.ts:1422-1423` — close already routes through `abortLlmLoopsForPanel(panelId)`; spec correctly builds on it rather than replacing it.
  - `summoner-web.ts:195` — `originOk` returns `true` for empty/`"null"` Origin today; `tokenOk` (`:177-186`) is query-only; HTML reads token from `location.search` (`:1461`). All confirmed.
  - `shell-open.ts:107-110,130` — `isSummonerLoopbackUrl` *requires* the token query and `--app=${url}` carries it into argv. Confirmed.
  - `context-budget.ts:335` — `shrinkToolBodiesToFit` slices the whole `content` string, which severs a wrapped `</untrusted-…>` closer. Confirmed; D4-SHRINK-INNER is the right minimal fix.

  ## Confirmed pins

  D1-GET-READONLY, D1-SINGLETON, D2-UPLOAD-OWNER, D2-CLOSE-NOT-CHAT-ABORT, D3-NO-ARGV-TOKEN, D3-COOKIE-FIRST-PAINT, D3-POST-ORIGIN, D3-MUTATING-GET, D4-SHRINK-INNER, D5-THREAD-FANOUT (allowlist correct — no `chat.delta`, no confirm types), D5-CONFIRM-UNICAST. DoD table and file map match the code I read. The "将红" test list is consistent with what the D3 flip will break.

  ## Missing / still BLOCK

  None.

  ## Nits

  1. **Pin 11 wording vs. existing fanout.** "`security.confirmation.*` 仍 `originWs`" is imprecise: `companion/src/mcp/confirm-fanout.ts:74-96` already fans Allow/Deny to all authenticated non-summoner peers for summoner-origin and outbound-MCP confirmations (panel-origin stays origin-bound, `:131-135`). That is pre-existing, deliberate behavior from earlier batches and out of scope — but the pin should read "D5 thread fanout must not add confirm events; existing fanOutConfirmRequest semantics unchanged" so an implementer doesn't "fix" `confirm-fanout.ts` or, worse, conclude broadcast of confirms is now licensed.
  2. **Pin 7 vs. tests/curl.** Requiring exact Origin on every mutating POST means curl/test clients must send an explicit `Origin` header even with the token header. That's intended hardening, but call it out in the commit message so the red `summoner-web.test.ts` rewrites don't accidentally re-introduce "empty Origin 放行" to make tests pass.
  3. **Pin 8 scope.** Flipping mutating GETs (`/api/thread` select) to POST changes the overlay's JS fetch layer in the same commit — the file map covers `summoner-web.ts` but the DoD row for D3 doesn't mention it; a DoD line "overlay thread-select POSTs with cookie, no query token" would close the loop.
  4. **Pin 4 watcher tracking.** "无剩余同 thread 观看者 → nextRun 丢弃并停忙" implies a thread→watchers count that doesn't exist yet; cheap, but worth naming where it lives (lifecycle's `wsAuth`/`clients` set) so it doesn't grow into a new registry.

  ## Recalibrated: implement now? YES

  Nits 1–4 are wording/DoD tightenings, not path changes — fold them into the spec when the second dual review lands. Per the spec's own gate, implementation still waits for the second (claude) APPROVE*.

  VERDICT: APPROVE_WITH_NITS
