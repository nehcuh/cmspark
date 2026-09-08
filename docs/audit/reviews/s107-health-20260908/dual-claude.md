All pins spot-checked at my own reads. Compiling the independent verdict.

---

# Independent re-review — S107 health synthesis

**HEAD**: `4a63de56f1cd32da5470ab8dab09d9b61b6818d8` on `main` `[executed: git rev-parse]` — matches the gate. Review proceeds.

## 1. Per-BLOCK adjudication (my own reads, not lane quotes)

### X1 — Version split: **TRIGGERED** ✅
- `README.md:980` `当前阶段（0.6.0）` `[inspected]`
- `PRODUCT.md:4` `Version lock: companion/extension **0.6.0**` `[inspected]`
- `CLAUDE.md:37` `当前阶段：**产品 0.6.0**`; `CLAUDE.md:137` `活切点 0.6.0` `[inspected]`
- `docs/README.md:3` `产品 **0.6.0**`, `:49` GOAL aligned 0.6.0, `:175` facts follow **0.6.0** package.json `[inspected]`
- `docs/GOAL.md:3` `产品 0.6.0` `[inspected]`
- SoT side: `companion/package.json:3` = `0.6.6`, `chrome-extension/package.json:4` = `0.6.6`, `scripts/installer.nsi:14` fallback `0.6.6`, `companion/src/index.ts:31` banner `v0.6.6`, `AGENTS.md:3` `0.6.6` `[inspected]`
- `git tag --list 'v0.6*'` → empty; `git describe` → `v0.4.0-785-g4a63de56` `[executed]`
- CHANGELOG `[Unreleased]` (workspace #469–#485, enterprise #451–#457) present at HEAD; last released section `[0.6.6] — 2026-09-07` (#423 only) `[inspected]`

Not rejected — live docs are **not** lockstep 0.6.6.

### X2 — Knowledge「全选灌库」vs TF-IDF top-k: **TRIGGERED** ✅
- `README.md:364–367`: 自动 = 勾选 ∪ hostname；全选 =「所有知识文档全部注入」`[inspected]`
- `companion/src/skills/skill-engine.ts:80–86`: `KNOWLEDGE_DOC_TOPK_AUTO = 5`, `KNOWLEDGE_DOC_TOPK_ALL = 8`, `KNOWLEDGE_INJECT_BUDGET_CHARS = 8000`, `KNOWLEDGE_SCORE_MIN = 0.10` `[inspected]`
- `skill-engine.ts:1472–1474`: `topk = … AUTO:ALL; picked = scored.filter(raw >= MIN).slice(0, topk)` `[inspected]`
- Default path confirmed live: `message-router.ts:1234` `thread?.knowledge_smart_match !== false` (default on) and `:1247–1253` passes `rest.message` as query → real chat traffic takes the top-k branch `[inspected]`. The README text describes only the legacy branch (`smartMatch=false` / empty query). Not an overclaim by the synthesis.

### X3 — Capture geometry: **TRIGGERED** ✅
- `companion/src/summoner/shell-open.ts:29` `export const OVERLAY_WINDOW_SIZE = { w: 1040, h: 760 } as const` `[inspected]`
- `companion/src/summoner-web.ts:1708–1710` `if(compact){w=360;h=420}` — 360×420 is the compact branch; `:1526` 「紧凑窗口」toggle; `:1505–1518` 资料与工具 rail (场景/知识/技能/MCP/浏览器) on the default window `[inspected]`
- `README.md:16,223` and `PRODUCT.md:3` still sell 360×420 naming `OVERLAY_WINDOW_SIZE` `[inspected]`

### BLOCK 4 — Host「收起」ends meeting: **TRIGGERED** ✅
- `ContextPanelHost.tsx:285–293` 「收起」/`aria-label="收起面板"` → only `closePanel()` `[inspected]`
- `MeetingPanel.tsx:599–612` unmount effect: `phaseRef.current !== "idle" && !finalizedRef.current` → sends `meeting.end` `[inspected]`
- `MeetingPanel.tsx:1217–1239` panel-local button is 「结束并收起」`[inspected]`

One calibration note, not a rejection ground: the unmount-ends-session behavior is **deliberate** (in-file comment: prevents stuck `status=recording`). The defect is real regardless — a control labeled 「收起」 that destroys a recording is a copy/state lie; both synthesis remedies (relabel while active, or drop the unmount `meeting.end`) remain valid.

### BLOCK 5 — 「设置 → 听写」dead path: **TRIGGERED** ✅
- `SettingsPage.tsx:7` eight categories include `voice → 输入与语音`; **no 听写 page exists** `[inspected]`
- Live stale copy: `MeetingPanel.tsx:1271,1303` 「设置 → 听写 → …」; `companion/src/summoner-web.ts:1749` `STT_NEED_MODEL="侧栏 ⋯ → 设置 → 听写 → …"`; `MeetingPanel.tsx:1583` 「设置 → 听写方式」`[inspected]`

## 2. Ship-blockers the synthesis might have missed — none found

| Probe | Result |
|---|---|
| Official NSIS payload is SEA? | **No.** `build-windows-installer.sh:95–98` hard-fails staging containing `cmspark-agent.exe` (`[inspected]`); `installer.nsi:87–89` deletes leftover SEA before `File /r` `[inspected]`; my own `ls dist-package/cmspark-windows-x64/` → `node.exe` + `cmspark-agent.js`, no exe `[executed]` |
| Default outbound expanded past 8? | **No.** `profile.ts:21–30` `OUTBOUND_MCP_ALLOWLIST` = exactly 8 entries; interact extras + `outbound_context_v1` (`+site_context`) are named profiles only (`:40–67`) `[inspected]`; `l2-admission.ts:926–936` `if (isOutboundMcpCall) skipConfirmation = false` `[inspected]`; `config.ts:480` `require_grant: true` `[inspected]` |
| Live docs already 0.6.6 (X1 false)? | **No** — see X1. Docs still 0.6.0 |
| 全选 really injects whole library? | **No** — top-k slice confirmed; whole-library only on the legacy/degraded branch |
| Hidden authz bypass / path escape / pairing skip? | **None found.** WS pre-auth terminate + per-peer `authenticated` state (`ws/lifecycle.ts:91–98`) `[inspected]`; `thread-manager.ts:553–575` `isSafeThreadId` fail-closed + realpath-relative containment `[inspected]`; `FORBIDDEN_PACK_KEYS` `packs/types.ts:282` `[inspected]`; overlay `mcp.toggle_server` residual confirmed real (`summoner-acl.ts:47`, `message-router/handlers/mcp.ts:393–427` → `replaceMcpServers`, stdio-enable L2 fail-closed) but is exactly what the synthesis lists as MAJOR and quarantines under #230 freeze `[inspected]` |
| Assistant args persist unredacted? | **Confirmed, and disclosed, not hidden.** `adapter.ts:1159–1178` `persistAssistantDraft` writes raw `tool_calls` (with `function.arguments`) `[inspected]` — synthesis carries it as MAJOR |

## 3. Frozen residuals re-litigated as BLOCK? — No

Synthesis explicitly parks #230 overlay-acl, #228 no-expand, #363 (6/10 < 0.85), and 0.7.0 dual-scene acceptance under 「冻 / 不在本轮」 (synthesis.md:97–99). SEC/CORR lanes issued 0 BLOCK; ARCH's composition attacks (Pack god-mode, L2 skip, outbound widen) all came back blocked. PTY/GOAL is handled as **doc honesty** (M-level), not a demand to redesign.

## 4. Hidden Critical/BLOCK? — None evidenced

I hunted independently across WS auth, thread paths, outbound grants, pack trust, and overlay ACL. Everything I found that rises above nit is already in the synthesis's MAJOR list. Nothing was suppressed.

## Extra nits found by this re-review (non-blocking)

1. `docs/README.md:49` — GOAL row also claims alignment with **0.6.0**; an additional X1 instance beyond those the synthesis enumerates.
2. Stale 「听写」 copy is broader than the synthesis bullet: `MeetingPanel.tsx:1583` tooltip 「设置 → 听写方式」 and `meeting-diarize-copy.ts:24` (lane F caught these; the synthesis's BLOCK 5 line under-counts).
3. Lane D's cite `meeting/diarize-cluster.ts` — actual path is `companion/src/meeting/diarize-cluster.ts`; file exists, path label imprecise. `win-sapi.ts` and `voice-ptt.ts` exist as cited `[inspected]`.
4. `MeetingPanel.tsx:599` in-file comment documents the unmount-`meeting.end` as an intentional fix (anti-stuck-status); the fix direction chosen in P0 UX item 5 should prefer **relabel** over removing the unmount end, or the stuck-status regression returns.
5. NSIS `File /r` no-wipe leaves unknown leftovers by design (`installer.nsi:87–94` `[inspected]`); synthesis already treats this as P1-adjacent, correctly not a launch defect since `launch-hidden.vbs` prefers node+js.

## Coverage declaration — what I did NOT re-verify

- **Live-install state**: ARP DisplayVersion, INSTDIR leftovers (`gif.jpg`/`gifcode_test`), daemon/tray process liveness, port 23401 LISTENING — took lanes' `[executed]` claims as reported; consistent with the installer code I read, but not re-run here.
- **CLI runtime**: C-01/C-02/C-03 verified at source only (`index.ts:31,334–340,465–491` — no `--version`/`-V` case exists; `stop`/`status` stubs confirmed) `[inspected]`, not executed.
- **PTY darwin gate**: took CHANGELOG + lane B/E cites; did not open `pty/session.ts` myself.
- **UX screenshots** and 320px rendering claims.
- **Full l2-admission algebra** beyond the outbound skip block; WS handshake against a live socket; `mcp.list` env-redaction; `ws-auth` crypto.
- **GitHub issue state** of #258–#260 / #230 / #228 (lane A also did not fetch; consistent).
- Line numbers in `docs/meeting-and-dictation-user-guide.md`, `docs/summoner-user-guide.md`, `docs/TESTING.md` (TinyClick), root audit reports — lane cites only.

The synthesis's six-lane split, its five BLOCKs, its cross-hit table, and its freeze discipline all survived independent spot-check against live code. Verdict on the synthesis: accurate, honest about evidence levels, and correctly separates dogfood-readiness from release-honesty.

VERDICT: APPROVE_WITH_NITS
