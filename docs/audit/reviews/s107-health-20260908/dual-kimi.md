• HEAD confirmed: `4a63de56` on `main`. Now spot-checking the live pins.

• ## Dual re-review — S107 health synthesis

  HEAD verified: `4a63de56f1cd32da5470ab8dab09d9b61b6818d8` on `main` (`git describe` = `v0.4.0-785-g4a63de56`, no `v0.6.x` tag) `[executed]`. Proceeding.

  ### Per-BLOCK verification (live files, my own reads)

  **X1 — version split: TRIGGERED.**
  Docs lock 0.6.0: `README.md:980` 「当前阶段（0.6.0）」, `PRODUCT.md:4` 「Version lock: companion/extension **0.6.0**」, `CLAUDE.md:37` + `CLAUDE.md:137` 「活切点 0.6.0」, `docs/GOAL.md:3` + `:11` `[inspected]`. Lockstep is 0.6.6: `companion/package.json:3`, `chrome-extension/package.json:4`, `scripts/installer.nsi:14` fallback `[inspected]`. CHANGELOG `[Unreleased]` block (#469–#485) sits at HEAD `[inspected]`. X1 is true, not stale.

  **X2 — knowledge「全选灌库」: TRIGGERED.**
  `README.md:364–367` still teaches 自动 = 勾选 ∪ hostname and 全选 = 「所有知识文档全部注入」 `[inspected]`. Code: `companion/src/skills/skill-engine.ts:80,82,84` (`KNOWLEDGE_DOC_TOPK_AUTO=5`, `TOPK_ALL=8`, budget 8000) and `:1472–1474` — even `all` mode is TF-IDF-scored, score-floor-filtered, `slice(0, 8)`; whole-library injection only exists on the legacy `smartMatch=false` path, which README never mentions `[inspected]`. The 「全选 = inject everything」belief is false on the default path.

  **X3 — Capture 360×420 vs `OVERLAY_WINDOW_SIZE`: TRIGGERED.**
  `companion/src/summoner/shell-open.ts:29` = `{ w: 1040, h: 760 }` `[inspected]`. Docs still name the constant against 360×420: `README.md:223` （尺寸：**360×420**（代码 `OVERLAY_WINDOW_SIZE`）), also `README.md:16,53,212`; `PRODUCT.md:3,33`; `docs/summoner-user-guide.md:18` `[inspected]`. Direct doc-vs-named-constant contradiction.

  **UX BLOCK — Host「收起」kills meeting: TRIGGERED.**
  `ContextPanelHost.tsx:285–293`: generic 收起 button (`aria-label="收起面板"`) calls only `closePanel()` `[inspected]`. `MeetingPanel.tsx:600–613`: unmount cleanup sends `meeting.end` when `phase !== "idle"` and not finalized `[inspected]`. The in-panel button is honest (「结束并收起」, `MeetingPanel.tsx:1239`) `[inspected]` — which makes the adjacent Host button's collapse label worse, not better. Collapse = kill confirmed.

  **BLOCK — 「设置 → 听写」 dead path: TRIGGERED.**
  `SettingsPage.tsx:6–13`: eight categories, voice lives under 「输入与语音」; no 听写 page `[inspected]`. Live recovery copy still routes to the dead path: `MeetingPanel.tsx:1271` （设置 → 听写 → 启用本机转写）, `:1303`, plus `:506/:768/:936` using 「设置 › 听写」; `meeting-diarize-copy.ts:24` `[inspected]`.

  ### Rejection criteria — none met

  1. **No listed BLOCK is false.** All five verified above against live code with correct file:line.
  2. **No missed ship-blocker among the named suspects:**
     - NSIS payload is not SEA: `scripts/build-windows-installer.sh:95–100` hard-fails on `cmspark-agent.exe` in staging `[inspected]`.
     - Default outbound L1 is exactly 8 tools: `companion/src/outbound-mcp/profile.ts:21–30`; interact/context extras are named profiles only (`:40–67`), #228 not expanded `[inspected]`.
     - Docs are not lockstep 0.6.6 (X1 true — see above).
     - 「全选」 does not inject the whole library (X2 true — see above).
  3. **Frozen residuals are not re-litigated as BLOCK.** Synthesis lists #230 / #228 / #363 / 0.7.0 under 冻·不在本轮； overlay `mcp.toggle_server` and assistant-args persistence are carried as MAJOR, matching the security lane. Correct.
  4. **No hidden Critical.** I read all six lane files in full; the synthesis faithfully carries PRODUCT/SKEPTIC/UX REJECTs and CORR/SEC/ARCH approvals, including SEC M1 (`adapter.ts` persist hole) and M2 (overlay MCP toggle) as MAJOR — nothing downgraded or omitted.

  ### Extra nits (non-blocking)

  - `docs/audit/reviews/s107-health-20260908/dual-claude.md` is 0 bytes and `dual-kimi.md` is a 1-line stub `[executed]` — the dual-review artifacts in the review package are incomplete at review time.
  - BLOCK 5 is slightly broader than cited: `MeetingPanel.tsx:506/768/936` also use the dead 「设置 › 听写」 path. Conversely, `meeting-diarize-copy.ts:24` 「设置 → 听写方式」 is borderline — 「听写方式」 survives as an *item* inside 输入与语音 per `SettingsPage.tsx:7`; the BLOCK stands on the MeetingPanel page-path lines regardless.
  - CLI nit confirmed independently: no `--version` case exists in the `companion/src/index.ts:469–491` switch, so it falls to `Unknown command` + exit 1 `[inspected]` — consistent with the synthesis MAJOR.
  - X4 spot-check: `#258`/`#259` code presence verified (`chrome-extension/src/contents/voice-ptt.ts`, `companion/src/voice/win-sapi.ts` exist) while `PRODUCT.md:5` still lists #258–#260 as 余项 `[executed]`/`[inspected]`.

  ### Coverage declaration

  I did **not** independently re-verify: the security lane's A–N recheck rows (thread-id sanitize, PTY env/cwd jail, redaction rules, outbound audit fields); the live INSTDIR/daemon machine state; `KnowledgeSubPanel` UI copy honesty; god-file LOC counts; or any test suite run. For those I relied on lane evidence, which is internally consistent and not contradicted by anything I did open.

  VERDICT: APPROVE_WITH_NITS

