# Implementation Plan — Trust IA + Autopilot packaging

| Field | Value |
|-------|--------|
| Date | 2026-08-02 |
| Status | **GO** — dual-review APPROVE_WITH_NITS（Claude+Pi 20260802-144203）；nits folded |
| Design SoT | [../specs/2026-08-02-trust-ia-autopilot-design.md](../specs/2026-08-02-trust-ia-autopilot-design.md) |
| Adversary | [../../audit/reviews/trust-autopilot-ia-adversary-synthesis-20260802.md](../../audit/reviews/trust-autopilot-ia-adversary-synthesis-20260802.md) |
| Gate | Pi + Claude both APPROVE / APPROVE_WITH_NITS before code |

---

## Capability declaration

```text
Surface:      n/a
L2-classes:   (none)
Compose:      none
Autonomy:     n/a (no multi-worker algebra change)
Trust:        UI packaging of auto_approve_dangerous / allow_all_schemes / auto_approve_enterprise_tools
Channel:      community | enterprise (UI honesty only in P0; P1 enforces grey-out)
```

---

## Phase P0 — IA + rename (no gate algebra)

### Task 0 — Freeze locks in PR description

Copy D1–D12 / S1–S5 / hard floors into PR body. No code.

### Task 1 — SettingsSlideout IA regroup + rename

**File**: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx`

1. Rename God-mode checkbox label → **协议解锁（允许非 http(s) 协议）**  
   - Badge 文案同步；短语面板「确认开启协议解锁」  
   - Help：明确 **不含** shell/netsec/CU/spawn；旧称可小字「曾用名 God-mode」  
2. Move three toggles（自动批准危险 / 企业 B / 协议解锁）into collapsible **高级 · 独立闸门**（default collapsed；任 flag true 时 auto-expand 或顶部状态提示）。  
3. Promote truth matrix from monospace dump to structured HTML/table (网页 L2 | shell/netsec | 协议 L1 | CU).  
4. Add **运行自主度** section **above** 安全设置：  
   - **本批 P0+P1 同 PR**：直接放档位武装控件（禁止「下一批次」占位）。  
5. Keep Cookie / domain whitelist outside 高级（细粒度信任，非全局巡航）。  
6. Do **not** change `sendSecurityFlagConfig` / phrase constants wire protocol.

### Task 2 — User docs lockstep

Update in same PR:

- `docs/confirm-center-user-guide.md` §5（若提到 God-mode 用户路径）  
- `docs/mission-pack-usage.md`（god 不跳 shell 句 → 协议解锁命名）  
- `docs/TROUBLESHOOTING.md` 相关条  
- Optional footnote in `docs/adr/010-tiered-privilege-godmode.md`：「UI 名称：协议解锁；字段不变」

### Task 3 — Extension tests / copy guards（if any snapshot）

- Grep-based test or component test: primary visible label not `God-mode`（allow comment/旧称）.  
- Existing security arm tests remain green（companion untouched in P0-only）。

### P0 verification

```bash
# [executed] after implement
rg -n "God-mode" chrome-extension/src/sidepanel --glob '*.tsx'
# expect: only 旧称 / comments, not primary label
npm --prefix chrome-extension test   # or targeted
```

### P0 out of scope

- No companion `server.ts` skip algebra  
- No new config keys  
- No SafetyStrip badge（P1）

---

## Phase P1 — 运行自主度 arming

### Task 4 — Derive helpers（pure）

**Files** (prefer companion or shared):

- `deriveAutopilotTier(security): 'off' | 'browser' | 'full' | 'full_protocol' | 'custom'`  
- Mapping per design §5.2  
- Unit tests: bijection / custom when flags mismatch tier

Location options:

- `companion/src/security-autopilot.ts` + tests  
- Extension-only pure function if no companion protocol needed for P1

**P1 choice (locked)**: Extension-local pure derive + write existing config paths; companion remains flag-authoritative via existing `config.set` + phrase.

### Task 5 — Autopilot UI controls

**File**: `SettingsSlideout.tsx`

1. Radio tiers + consequences matrix component.  
2. Arm button → sequential per-flag `sendSecurityFlagConfig` with **same phrase**（N1: UX 上武装中 disable 交互 + loading「武装中…」至全部回写完成，避免徽章闪烁当「完成态」）.  
   - **网页巡航**：只 arm `auto_approve_dangerous=true`；并 `allow_all_schemes=false`（若当前 true 则 disarm 协议，无需 phrase）；**不触碰** enterprise flag。  
   - **全自动 / +协议**：按映射写对应 flag；enterprise 档仅在 `config.capability_profile === 'enterprise'` 可选（读 config 字段；未暴露则禁用企业档并 help「需 enterprise 配置」）。  
3. Disarm P1-A: set all three flags false（document warning）.  
4. 高级勾变更后 derive 显示 **自定义**。

### Task 6 — Status chrome

**Files**: SafetyStrip (preferred) / FocusBand fallback / agentStore as needed

1. Chip when any of three flags true: `巡航中` + short tier label from derive.  
2. Click → popover or inline 解除武装.  
3. Do not hide 急停.

### Task 7 — Audit UX

- On autopilot arm: optional client audit entry listing flags[].  
- Companion already logs `security.flag_armed` per flag — no reason collapse.

### Task 8 — Tests

| Test | Expect |
|------|--------|
| Derive tiers | table-driven |
| message-router / security-arm | existing green |
| Manual / e2e note | P1 DoD checklist in design §8 |

### P1 verification

```bash
npm --prefix companion test
npm --prefix chrome-extension test
# Manual: arm 网页巡航 → evaluate no L2; spawn still L2; protocol tier opens data: only when selected
```

### P1 out of scope

- Session/thread-scoped arm  
- spawn budget skip  
- CU session-trust auto  
- New `security.autopilot` config key

---

## Phase P2 — backlog only（not this batch）

- Session arm (process memory) + restart clear  
- TTL / idle disarm  
- spawn max_workers budget  
- 含桌面巡航  
- ADR-020 Trust packaging short amend if product name sticks

---

## File map (expected)

| Path | P0 | P1 |
|------|----|----|
| `chrome-extension/.../SettingsSlideout.tsx` | ✓ | ✓ |
| SafetyStrip / FocusBand / store | | ✓ |
| `docs/confirm-center-user-guide.md` | ✓ | |
| `docs/mission-pack-usage.md` | ✓ | |
| `docs/TROUBLESHOOTING.md` | ✓ | |
| `docs/adr/010-...` footnote | ✓ | |
| `companion/src/security-autopilot.ts` + tests | | optional |
| `companion/src/server.ts` | ✗ | ✗ |

---

## Rollback

- P0: revert Settings + docs only.  
- P1: disarm sets flags false; revert UI; config bools remain user-editable via 高级.

---

## Dual-review rejection gates (from security adversary)

Implementer and reviewers MUST REJECT if:

| # | Gate |
|---|------|
| R1 | Any code path makes shell/CU/spawn skip solely via `allow_all_schemes` |
| R2 | New autopilot key skips L2 without enterprise scope ∩ for shell/netsec |
| R3 | Pack can set arm flags |
| R4 | Arm without phrase on false→true |
| R5 | UI claims zero confirms for CU/spawn while floors remain（or inverse without matrix） |
| R6 | Companion skip algebra changed in “IA only” PR without tests |

---

## Suggested PR strategy

1. **PR1 (P0)** — rename + IA + docs — low risk, can land first.  
2. **PR2 (P1)** — autopilot arming + chip — after P0 or stacked.

Prefer dual-review of **design+this plan** before either PR. Implementation dual-review per PR after code.
