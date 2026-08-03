All verification complete. Here is my independent review.

---

# Dual external re-review: Anthropic Messages protocol + Coding-Plan gateway headers

## 0. Diff & repo verification

- `git status`/`git diff` confirm the patch file is current: working-tree diff = 2 docs-index lines only; the review target is the **new untracked design brief** `docs/decisions/llm-anthropic-protocol-design-2026-08-03.md` (not in the patch, so read directly). Patch is not stale.
- **R6 (material repo claims) — all verified accurate:**
  - `adapter.ts:1` header: "LLM adapter — OpenAI-compatible chat completions with tool calling"; `new OpenAI({baseURL…})` + `client.chat.completions.create` stream/tool loop — ✓
  - `llm-extract.ts:13–17` — `new OpenAI()` + `chat.completions.create` (non-streaming) — ✓
  - `config.ts:152–157, 213–219` — `llm` shape is exactly `{base_url, api_key, model_name, temperature, context_window}`; defaults DeepSeek OpenAI-compatible (`https://api.deepseek.com/v1`) — ✓
  - `settings-web.ts:459–464` — test connection hardcodes `POST {base}/chat/completions` + `Authorization: Bearer` — ✓
  - `package.json` — deps: `openai ^4.52.0`, **no** `@anthropic-ai/sdk` — ✓
  - `vision-pipeline.ts:3,118` — OpenAI client, separate from chat; vision OpenAI-only claim — ✓
  - `server.ts:5298` — chat model probe `GET {base}/models` — ✓
  - `logger.ts:26` — redaction regex `api[_-]?key` already subsumes `x-api-key` (brief's "扩展 redaction 含 x-api-key" is essentially already true) — ✓

## 1. Findings

**Blocking: none.** Rejection gates R1–R6 all pass (L7 hard-deny on first-party; L8 no OAuth/Max/cookie; L1 no thread migration; L3 explicit protocol, no auto-detect; §1/§12 explicitly not a cc-switch clone; no false repo claims).

**Must-fix before P0 code** (design-lock level, no redesign required):

1. **L7 must apply to the *union* of all header-injection paths, not just `client_header_profile`.** §3 ships `extra_headers` in the P0 config schema ("名称白名单；拒绝 Host/Cookie/hop-by-hop/CRLF") but §6's deny rule (§6 / L7) only gates `profile ≠ none`. A user could set `user-agent: claude-cli/…` + `x-app: cli` via `extra_headers` against `api.anthropic.com` and bypass the deny, violating the brief's own (C) red line (§0) and R1 in spirit. Fix: on first-party hosts, deny **any** header injection (profile headers **and** `extra_headers`, and any future free-form UA) — only the clean `cmspark-companion/<version>` UA is allowed. Same rule must cover Q3 option B if ever shipped.
2. **Pin the `max_tokens` derivation rule.** §4 says "Provider 默认（如 8192 或由 context_window 推导），后续可配置" — two candidate rules, non-deterministic for tests. Pick one (e.g. `min(8192, floor(context_window/8))`) and document that the Anthropic path has an output-cap parity difference vs the openai path (openai sends no `max_tokens`), so long code-generation turns will truncate differently.
3. **Add a cross-provider thread-resume test.** L1 keeps internal OpenAI shape, so a thread created under openai and resumed under anthropic must rebuild from persisted `assistant.tool_calls[]` + `role:tool` rows into Anthropic `tool_use`/`tool_result` blocks with matching ids (§4 convert table covers the mapping — make it a P0 unit test, both directions; also drop `reasoning_content` on the wire).

**Nits (non-blocking):**

- §3/L5: `profile: claude_code_compat` + `protocol: openai` is a **silent no-op** (headers only injected under anthropic). Either validate/warn in config load or document inertness explicitly.
- `auth_style` can wait for P1 unless a real gateway requires Bearer; schema field in P0 is fine.
- `x-api-key` redaction is already covered by `logger.ts:26` — just add a logger test in P0; also assert header **values** are never logged (only `header_names[]`), per §6.
- Pin value `claude-cli/2.1.220` — exact value is a nit; confirm against a real relay in P1 (it may already be outdated).
- SSRF guard `validateTestBaseUrl` (`settings-web.ts:177–194`) is URL-level and protocol-agnostic — confirm the anthropic probe path reuses it (it should).
- Doc Chinese/English mix is acceptable; keep consistent in implementation comments.
- Consider a `host`-match unit test for the L7 suffix matcher (`api.anthropic.com` exact, `foo.anthropic.com`, near-miss `anthropic.com.evil.io`).

## 2. Design questions 1–5

1. **Locks coherent/complete?** Yes for P0 with the two must-fixes above (L7 union coverage; max_tokens rule). No *blocking* lock missing. L1/L3/L8/L10 correctly draw the (A)/(B)/(C) separation of §0.
2. **Internal OpenAI shape + wire-only conversion — right architecture?** Yes. Dual persistence would be an unjustified thread-schema migration (R3) with zero user-visible benefit since the tool loop is OpenAI-shaped anyway. `fetch`+SSE over the SDK in P0 (L4) is correct for header/auth control; SDK as an optional P2 path is the right deferral.
3. **L7 correct/implementable?** Yes — host suffix match (`api.anthropic.com` / `*.anthropic.com`), enforced per-request "启动该轮 LLM 前失败" and in the settings probe (which §5 correctly reuses the same protocol+profile+auth). Extend to `extra_headers` (must-fix #1) and it's solid.
4. **CC identity system-prompt injection out of v1 — correct?** Yes, and it should stay out entirely absent a separate ADR. Coding-plan gateways gate on HTTP headers, not the system prompt; injecting "You are Claude Code…" changes model behavior and billing semantics. cc-switch does it for official-endpoint use, which is out of scope here.
5. **ADR-020 framing correct?** Yes — this is Composition/infra (wire transport under the existing single tool-loop), not a Surface change and not a new runtime. No "中层 Agent" mislabeling in the brief. The declaration (Surface unchanged / Compose = protocol adapter / Trust = owner-level opt-in config / Channel community) is faithful.

## 3. DECISIONS (Q1–Q4)

| # | Pick | Rationale |
|---|------|-----------|
| Q1 | **B** `Coding Plan 网关兼容头` | Compliance-safe label; discoverability carried by the §5 helper copy which already names "类似 Claude Code 的 User-Agent". Labeling the product UI "Claude Code 兼容" normalizes the spoof framing the brief itself red-lines. |
| Q2 | **B** config/CLI + tests first, UI in P1 | Protocol correctness is fully headlessly testable (DeepSeek regression + anthropic tool rounds + L7 deny); UI copy deserves its own compliance review pass. Brief §8 already defaults to this. |
| Q3 | **A** version pin only | Full custom UA multiplies the first-party-bypass surface and gateway fingerprint-gaming; version pin covers the documented gateway need. Revisit in P2 only with the same first-party deny. |
| Q4 | **B** fixture/mock + contract tests; real gateway smoke optional later | Vendor-agnostic and CI-reproducible; P0 must not depend on the user's private relay account. Acceptance #3's real-relay proof lands in P1 with the user's own relay — which is exactly what brief §8 P1 already says. |

Rejected-option defaults: A for Q1 loses discoverability → mitigate via helper copy; A for Q2 → settings-web probe lands in P1 but "test connection" stays openai-only until then (document); B for Q3/Q4 → same first-party deny + redaction rules apply.

## 4. Must-fix before P0 code

1. L7 deny covers `client_header_profile` **and** `extra_headers` (and any UA override) as a union on first-party hosts.
2. Deterministic `max_tokens` derivation rule; document output-cap parity difference vs openai.
3. Cross-provider thread-resume conversion test (both directions) + `reasoning_content` dropped on wire.

## 5. ADR-020 checklist

| Check | Result |
|-------|--------|
| Axes fit (Composition, not Surface/new runtime) | ✅ — transport swap inside existing single tool-loop; capability declaration present & consistent |
| Pack-first (no new primary Side Panel chrome) | ✅ — settings options in existing panels; a Pack cannot provide a wire protocol (runtime config, not scene recipe) |
| Confirm dialects | n/a — no new confirmation family |
| Trust monotonicity | ✅ — profile/`extra_headers` at api_key trust level (settings/CLI only), not agent/WS-writable; no gate loosened |
| originWs on new confirms | n/a — no new `securityConfirmations.request` paths |
| No second runtime | ✅ — `LlmProvider` is an interface inside the loop, not an agent framework |
| Experimental layers | n/a |

## 6. Summary

The brief is a well-structured, adversarial-synthesized design: correct architecture (wire-only conversion), correct security posture (L7 hard deny, L8 red line, honest UI copy, clean default identity), accurate repo claims, and a clear phasing that keeps P0 headless and testable. The three must-fix items are lock-level clarifications, not redesigns — none trip R1–R6.

VERDICT: APPROVE_WITH_NITS
