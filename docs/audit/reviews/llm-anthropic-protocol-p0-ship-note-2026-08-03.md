# Ship note — LLM Anthropic Messages protocol (P0)

| Field | Value |
|-------|--------|
| Date | 2026-08-03 |
| Status | **P0 landed** — dual M1 **both_approve** (`APPROVE_WITH_NITS` ×2) |
| SoT | [`docs/decisions/llm-anthropic-protocol-design-2026-08-03.md`](../../decisions/llm-anthropic-protocol-design-2026-08-03.md) |
| Synthesis | [`docs/decisions/llm-anthropic-protocol-dual-review-synthesis-2026-08-03.md`](../../decisions/llm-anthropic-protocol-dual-review-synthesis-2026-08-03.md) |
| Branch tip (base) | `8c70c3a` (working tree uncommitted at ship-note time) |
| Commit | **Not auto-committed** — leave to human |

---

## 1. Status

**P0 implementation landed.** Provider layer + Anthropic Messages (fetch + SSE) + L7 first-party header policy + adapter/title/extract wiring + fixture/contract tests. Default remains `protocol=openai` / `client_header_profile=none` (legacy configs unchanged via `deepMerge`).

P1 (UI / protocol-aware connection test / real gateway smoke) is **not** in this drop.

| Gate | Result |
|------|--------|
| Design dual-review | Claude + Pi **APPROVE_WITH_NITS** · `llm-anthropic-protocol-verdict-20260803-163315.json` |
| Node gates (Pi) | N1 **REJECT** → N1b **APPROVE_WITH_NITS** → N2 **APPROVE_WITH_NITS** → N3 **APPROVE_WITH_NITS** |
| Merge dual M1 | Claude + Pi **APPROVE_WITH_NITS** · `both_approve: true` |
| Unit tests (P0 files) | [executed] **62 pass / 0 fail** (`llm-headers-policy` + `llm-provider-anthropic` + `model-probe`) |
| Full suite (M1 review) | [inspected from review] 2274 + 15 settings · 0 fail |

---

## 2. Files changed (summary)

### New (runtime + tests)

| Path | Role |
|------|------|
| `companion/src/llm/provider.ts` | `LlmProvider` / `createProvider` / canonical stream types |
| `companion/src/llm/providers/openai.ts` | OpenAI-compatible provider (DeepSeek path) |
| `companion/src/llm/providers/anthropic.ts` | Anthropic Messages `fetch` + SSE (no `@anthropic-ai/sdk`) |
| `companion/src/llm/providers/anthropic-convert.ts` | Wire convert, `max_tokens`, tool id sanitize, URL resolve |
| `companion/src/llm/providers/headers.ts` | Clean vs `claude_code_compat` headers; L7 first-party union deny |
| `companion/tests/llm-headers-policy.test.ts` | L7 / trailing-dot FQDN / denylist unit tests |
| `companion/tests/llm-provider-anthropic.test.ts` | SSE fixtures, multi-turn mock, cross-protocol resume |

### Modified

| Path | Role |
|------|------|
| `companion/src/config.ts` | `protocol`, `auth_style`, `client_header_profile`, pin fields + defaults |
| `companion/src/llm/adapter.ts` | Chat path → `createProvider` / `streamChat` |
| `companion/src/llm/llm-extract.ts` | Extract + title path → `provider.complete` |
| `companion/src/server.ts` | Model probe soft-skip when `protocol=anthropic` |
| `companion/src/settings-web.ts` | HTTP `/api/test` soft-skip for anthropic (no full UI) |
| `companion/tests/model-probe.test.ts` | Anthropic soft-skip + OpenAI regression |

### Design / review artifacts (docs)

| Path | Role |
|------|------|
| `docs/decisions/llm-anthropic-protocol-design-2026-08-03.md` | Direction-locked brief |
| `docs/decisions/llm-anthropic-protocol-dual-review-synthesis-2026-08-03.md` | Must-fix merge table |
| `docs/audit/reviews/llm-anthropic-*` | Design dual, N1/N1b/N2/N3 Pi gates, M1 dual patches + reviews |
| `docs/README.md`, `docs/optimization-plan-post-adr-020.md` | Index pointers (minor) |

---

## 3. Node Pi verdicts + M1 dual verdicts (paths)

### Design dual-review

| Reviewer | Verdict | Path |
|----------|---------|------|
| Claude | APPROVE_WITH_NITS | `docs/audit/reviews/llm-anthropic-protocol-claude-20260803-163315.md` |
| Pi | APPROVE_WITH_NITS | `docs/audit/reviews/llm-anthropic-protocol-pi-20260803-163315.md` |
| JSON | both | `docs/audit/reviews/llm-anthropic-protocol-verdict-20260803-163315.json` |

### Implementation gates (Pi-only nodes)

| Node | Verdict | Review | Verdict JSON | Diff |
|------|---------|--------|--------------|------|
| **N1** (headers + config) | **REJECT** | `docs/audit/reviews/llm-anthropic-n1-pi-20260803-165421.md` | `…/llm-anthropic-n1-verdict-pi-20260803-165421.json` | `…/llm-anthropic-n1-diff-20260803-165421.patch` |
| **N1b** (trailing-dot FQDN fix) | **APPROVE_WITH_NITS** | `docs/audit/reviews/llm-anthropic-n1b-pi-20260803-165856.md` | `…/llm-anthropic-n1b-verdict-pi-20260803-165856.json` | `…/llm-anthropic-n1b-diff-20260803-165856.patch` |
| **N2** (Anthropic provider + convert) | **APPROVE_WITH_NITS** | `docs/audit/reviews/llm-anthropic-n2-pi-20260803-170828.md` | `…/llm-anthropic-n2-verdict-pi-20260803-170828.json` | `…/llm-anthropic-n2-diff-20260803-170828.patch` |
| **N3** (adapter / extract / probe wiring) | **APPROVE_WITH_NITS** | `docs/audit/reviews/llm-anthropic-n3-pi-20260803-171854.md` | `…/llm-anthropic-n3-verdict-pi-20260803-171854.json` | `…/llm-anthropic-n3-diff-20260803-171854.patch` |

N1 reject root cause: trailing FQDN dot (`api.anthropic.com.`) bypassed first-party denylist; closed in N1b via hostname strip + regression tests.

### Merge dual M1 (final P0 gate)

| Reviewer | Verdict | Path |
|----------|---------|------|
| Claude | APPROVE_WITH_NITS | `docs/audit/reviews/llm-anthropic-p0-m1-claude-20260803-172929.md` |
| Pi | APPROVE_WITH_NITS | `docs/audit/reviews/llm-anthropic-p0-m1-pi-20260803-172929.md` |
| JSON | `both_approve: true` | `docs/audit/reviews/llm-anthropic-p0-m1-verdict-20260803-172929.json` |
| Diff | (tracked subset; untracked providers must be read from working tree) | `docs/audit/reviews/llm-anthropic-p0-m1-diff-20260803-172929.patch` |

Earlier M1 attempt timestamp `172353` superseded by `172929`.

---

## 4. What is NOT done (P1 UI + follow-ons)

Per design §8 **P1** and dual-review nits:

| Item | Notes |
|------|--------|
| **Settings UI protocol selector** | No Side Panel / settings-web form fields for `protocol` |
| **「Coding Plan 网关兼容头」checkbox** (L12 copy) | Config enum exists; no UI |
| **Side Panel alignment** | Extension settings still OpenAI-centric UX |
| **Protocol-aware connection test** | HTTP `/api/test` soft-skips anthropic; **WS `config.test`** (`message-router`) still calls `models.list()` → false fail under anthropic |
| **Anthropic model probe (real)** | P0 soft-skip only; full probe optional later |
| **Real Coding Plan gateway smoke** | Not a merge gate (L11 / Q4=B); optional user smoke in P1 |
| **skill-craft / skill-engine** | Still `new OpenAI()` — bypass `createProvider` when global protocol is anthropic (v1 sweep) |
| **`extra_headers` WS broadcast redaction** | N3 nit: values may reach extension via `config.get` (mask like `api_key`) |
| **Vision dual protocol** | Explicit non-goal (L10) — stays OpenAI-compatible |
| **OAuth / Max / Claude.ai session** | Red line — never |

---

## 5. How to enable `protocol=anthropic` manually

Edit `~/.cmspark-agent/config.json` under the `llm` object (restart companion after save).

### Direct Anthropic Messages (clean identity)

```json
{
  "llm": {
    "base_url": "https://api.anthropic.com",
    "api_key": "sk-ant-…",
    "model_name": "claude-sonnet-4-20250514",
    "protocol": "anthropic",
    "auth_style": "auto",
    "client_header_profile": "none",
    "anthropic_version": "2023-06-01"
  }
}
```

- Default auth for anthropic: `x-api-key` (via `auth_style: "auto"`).
- Keep `client_header_profile: "none"` on first-party hosts — L7 **hard-refuses** spoof-class headers against `api.anthropic.com` / `*.anthropic.com` / `claude.ai`.

### Third-party Coding Plan gateway (compat headers)

```json
{
  "llm": {
    "base_url": "https://YOUR-GATEWAY.example.com",
    "api_key": "…",
    "model_name": "…",
    "protocol": "anthropic",
    "client_header_profile": "claude_code_compat",
    "claude_code_compat_version": "2.1.220"
  }
}
```

- Use **only** against third-party gateways that require Claude Code–style UA / `x-app`.
- **Never** pair `claude_code_compat` (or spoofing `extra_headers`) with official Anthropic hosts — request is rejected before fetch.

### Defaults if fields omitted

| Field | Default |
|-------|---------|
| `protocol` | `openai` |
| `auth_style` | `auto` |
| `client_header_profile` | `none` |
| `claude_code_compat_version` | `2.1.220` |
| `anthropic_version` | `2023-06-01` |

### Smoke expectations (P0)

- Chat / tool loop / title / extract use the provider when companion is restarted with the config above.
- Side Panel **「测试连接」** may still fail on the WS path under anthropic until P1 (HTTP soft-skip returns skipped success only on settings-web).
- Prefer a real multi-turn tool chat once credentials are set; unit fixtures already cover convert/SSE/L7.

---

## 6. Residual nits (non-blocking, from M1)

1. ADR-020 capability declaration missing on implementer prompt (process only; no new Surface tools).
2. skill-craft / skill-engine OpenAI hard-wire (v1).
3. WS `config.test` not protocol-aware (P1).
4. Streaming usage: partial input/output events; last-event-wins may drop `prompt_tokens` on Anthropic stream (adapter merge follow-up).
5. Patch artifacts omit untracked provider files — reviewers must use full working tree.

---

## 7. Explicit non-goals still hold

- No Claude Max / OAuth / session cookie hijack  
- No system-prompt injection 「You are Claude Code」  
- No silent protocol detection from `base_url`  
- No P0 dependency on a live third-party Coding Plan account  

---

*P0 ship note · 2026-08-03 · leave git commit to human · no force-push*
